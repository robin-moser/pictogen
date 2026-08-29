import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";

import { buildApp } from "../server/app.js";
import { parseConfig } from "../server/config.js";
import { openDatabase } from "../server/db.js";

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
      DATA_DIR: dataDir,
    });
    const database = openDatabase({ databasePath: config.databasePath });
    const app = await buildApp({ config, database });
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

  it("rejects files without an allowed image signature", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "pictogen-assets-"));
    temporaryDirectories.push(dataDir);
    const config = parseConfig({
      NODE_ENV: "test",
      OPENROUTER_API_KEY: "test-key",
      DATA_DIR: dataDir,
    });
    const database = openDatabase({ databasePath: config.databasePath });
    const app = await buildApp({ config, database });
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
