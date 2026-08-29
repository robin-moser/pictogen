import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../server/app.js";
import { parseConfig } from "../server/config.js";
import { openDatabase } from "../server/db.js";
import { createEmptyDraft } from "../shared/contracts.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function createTestApp() {
  const dataDir = mkdtempSync(join(tmpdir(), "pictogen-sessions-"));
  temporaryDirectories.push(dataDir);
  const config = parseConfig({
    NODE_ENV: "test",
    OPENROUTER_API_KEY: "test-key",
    DATA_DIR: dataDir,
  });
  const database = openDatabase({ databasePath: config.databasePath });
  const app = await buildApp({ config, database });

  return app;
}

describe("session API", () => {
  it("resolves local and forwarded identities", async () => {
    const app = await createTestApp();

    const localResponse = await app.inject({ method: "GET", url: "/api/me" });
    const forwardedResponse = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { "remote-user": "  alice  " },
    });

    expect(localResponse.json()).toEqual({ user: "user" });
    expect(forwardedResponse.json()).toEqual({ user: "alice" });

    await app.close();
  });

  it("creates, updates, lists, and deletes a persistent session", async () => {
    const app = await createTestApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Winter studies" },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      title: "Winter studies",
      draft: createEmptyDraft(),
      knownCostMicrousd: 0,
      costComplete: true,
      activeJobCount: 0,
    });

    const sessionId = createResponse.json<{ id: string }>().id;
    const draft = {
      ...createEmptyDraft(),
      prompt: "Editorial photograph of a lighthouse in winter fog",
      promptModifiers: { shot: ", establishing shot" },
      resolution: "2K" as const,
      aspectRatio: "16:9" as const,
      count: 3,
    };
    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${sessionId}`,
      payload: { title: "Lighthouse", draft },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({ title: "Lighthouse", draft });

    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`,
    });
    const listResponse = await app.inject({
      method: "GET",
      url: "/api/sessions",
    });

    expect(detailResponse.json()).toMatchObject({ title: "Lighthouse", draft });
    expect(listResponse.json()).toEqual([
      expect.objectContaining({ id: sessionId, title: "Lighthouse" }),
    ]);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/sessions/${sessionId}`,
    });
    const missingResponse = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`,
    });

    expect(deleteResponse.statusCode).toBe(204);
    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json()).toEqual({
      error: {
        code: "SESSION_NOT_FOUND",
        message: "Session not found.",
      },
    });

    await app.close();
  });

  it("does not disclose sessions across owners", async () => {
    const app = await createTestApp();
    const aliceHeaders = { "remote-user": "alice" };
    const bobHeaders = { "remote-user": "bob" };
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: aliceHeaders,
      payload: { title: "Alice private" },
    });
    const sessionId = createResponse.json<{ id: string }>().id;

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/sessions",
      headers: bobHeaders,
    });
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`,
      headers: bobHeaders,
    });
    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${sessionId}`,
      headers: bobHeaders,
      payload: { title: "Taken over" },
    });
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/sessions/${sessionId}`,
      headers: bobHeaders,
    });

    expect(listResponse.json()).toEqual([]);
    expect(detailResponse.statusCode).toBe(404);
    expect(updateResponse.statusCode).toBe(404);
    expect(deleteResponse.statusCode).toBe(404);

    const aliceDetailResponse = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`,
      headers: aliceHeaders,
    });
    expect(aliceDetailResponse.json()).toMatchObject({
      title: "Alice private",
    });

    await app.close();
  });

  it("rejects cross-origin mutations", async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { origin: "https://attacker.example" },
      payload: { title: "Blocked" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: "ORIGIN_NOT_ALLOWED",
        message: "Cross-origin requests are not allowed.",
      },
    });

    await app.close();
  });
});
