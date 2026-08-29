import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";

import { buildApp } from "../server/app.js";
import { detectImageType } from "../server/services/assets.js";
import { parseConfig } from "../server/config.js";
import { openDatabase } from "../server/db.js";
import { assets, users } from "../server/db/schema.js";
import {
  authenticateTestRequests,
  forwardAuthTestEnvironment,
} from "./test-auth.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function multipart(sessionId: string, image: Buffer) {
  const boundary = "pictogen-test-boundary";
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="sessionId"\r\n\r\n${sessionId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      image,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe("asset API", () => {
  it("stores valid uploads privately and scopes their access to the owner", async () => {
    const png = await sharp({
      create: {
        width: 1600,
        height: 800,
        channels: 4,
        background: { r: 20, g: 40, b: 60, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const dataDir = mkdtempSync(join(tmpdir(), "pictogen-assets-"));
    temporaryDirectories.push(dataDir);
    const config = parseConfig({
      NODE_ENV: "test",
      OPENROUTER_API_KEY: "test-key",
      ...forwardAuthTestEnvironment,
      DATA_DIR: dataDir,
    });
    const database = openDatabase({ databasePath: config.databasePath });
    const app = authenticateTestRequests(await buildApp({ config, database }));
    const aliceHeaders = { "remote-user": "alice" };
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: aliceHeaders,
      payload: { title: "References" },
    });
    const sessionId = created.json<{ id: string }>().id;

    const upload = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: { ...aliceHeaders, ...multipart(sessionId, png).headers },
      payload: multipart(sessionId, png).payload,
    });

    expect(upload.statusCode).toBe(201);
    expect(upload.json()).toMatchObject({
      sessionId,
      kind: "reference",
      mimeType: "image/jpeg",
      width: 1200,
      height: 600,
      blurHash: expect.any(String),
      starred: false,
    });
    const assetId = upload.json<{ id: string }>().id;

    const detail = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`,
      headers: aliceHeaders,
    });
    expect(detail.json()).toMatchObject({ references: [{ id: assetId }] });

    const asset = await app.inject({
      method: "GET",
      url: `/api/assets/${assetId}`,
      headers: aliceHeaders,
    });
    const otherOwner = await app.inject({
      method: "GET",
      url: `/api/assets/${assetId}`,
      headers: { "remote-user": "bob" },
    });

    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toBe("private");
    expect(asset.headers["content-type"]).toContain("image/jpeg");
    expect(await sharp(asset.rawPayload).metadata()).toMatchObject({
      format: "jpeg",
      width: 1200,
      height: 600,
    });
    expect(otherOwner.statusCode).toBe(404);

    await app.close();
  });

  it("persists output shortlist changes and scopes them to the owner", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "pictogen-assets-"));
    temporaryDirectories.push(dataDir);
    const config = parseConfig({
      NODE_ENV: "test",
      OPENROUTER_API_KEY: "test-key",
      ...forwardAuthTestEnvironment,
      DATA_DIR: dataDir,
    });
    const database = openDatabase({ databasePath: config.databasePath });
    const app = authenticateTestRequests(await buildApp({ config, database }));
    const aliceHeaders = { "remote-user": "alice" };
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: aliceHeaders,
      payload: { title: "Shortlist" },
    });
    const sessionId = created.json<{ id: string }>().id;
    const aliceId = database.orm.select().from(users).get()?.id;
    expect(aliceId).toBeDefined();
    if (!aliceId) return;
    const outputId = crypto.randomUUID();
    database.orm
      .insert(assets)
      .values({
        id: outputId,
        ownerId: aliceId,
        sessionId,
        jobId: null,
        kind: "output",
        sha256: "test",
        storagePath: `${outputId}.png`,
        mimeType: "image/png",
        bytes: 100,
        width: 8,
        height: 8,
        blurHash: null,
        starred: false,
        ordinal: 0,
        createdAt: new Date().toISOString(),
      })
      .run();

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/assets/${outputId}`,
      headers: { "remote-user": "bob" },
      payload: { starred: true },
    });
    const starred = await app.inject({
      method: "PATCH",
      url: `/api/assets/${outputId}`,
      headers: aliceHeaders,
      payload: { starred: true },
    });

    expect(forbidden.statusCode).toBe(404);
    expect(starred.statusCode).toBe(200);
    expect(starred.json()).toMatchObject({ id: outputId, starred: true });
    expect(database.orm.select().from(assets).get()?.starred).toBe(true);
    await app.close();
  });

  it("rejects files without an allowed image signature", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "pictogen-assets-"));
    temporaryDirectories.push(dataDir);
    const config = parseConfig({
      NODE_ENV: "test",
      OPENROUTER_API_KEY: "test-key",
      ...forwardAuthTestEnvironment,
      DATA_DIR: dataDir,
    });
    const database = openDatabase({ databasePath: config.databasePath });
    const app = authenticateTestRequests(await buildApp({ config, database }));
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "References" },
    });
    const sessionId = created.json<{ id: string }>().id;
    const body = multipart(sessionId, Buffer.from("not an image"));

    const upload = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: body.headers,
      payload: body.payload,
    });

    expect(upload.statusCode).toBe(400);
    expect(upload.json()).toEqual({
      error: {
        code: "ASSET_INVALID",
        message: "Upload a JPEG, PNG, WebP, HEIC, or AVIF image.",
      },
    });
    await app.close();
  });
});

describe("detectImageType", () => {
  it("recognises SVG behind a byte-order mark, declaration, comment, or doctype", () => {
    const documents = [
      "<svg xmlns='http://www.w3.org/2000/svg'/>",
      "\uFEFF<svg viewBox='0 0 1 1'></svg>",
      "\n  <?xml version='1.0'?>\n<svg></svg>",
      "<!-- a > inside a comment --><svg></svg>",
      "<?xml version='1.0'?><!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN' 'svg11.dtd'><svg></svg>",
    ];
    for (const document of documents) {
      expect(detectImageType(Buffer.from(document))).toEqual({
        mimeType: "image/svg+xml",
        extension: "svg",
      });
    }
  });

  it("rejects markup that only mentions SVG", () => {
    const documents = [
      "<html><body><svg></svg></body></html>",
      "not an image",
      "<svgx></svgx>",
      "",
    ];
    for (const document of documents) {
      expect(detectImageType(Buffer.from(document))).toBeNull();
    }
  });
});
