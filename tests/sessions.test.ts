import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../server/app.js";
import { parseConfig } from "../server/config.js";
import { openDatabase } from "../server/db.js";
import { createEmptyDraft } from "../shared/contracts.js";
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

async function createTestApp(extra: NodeJS.ProcessEnv = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "pictogen-sessions-"));
  temporaryDirectories.push(dataDir);
  const config = parseConfig({
    NODE_ENV: "test",
    OPENROUTER_API_KEY: "test-key",
    ...forwardAuthTestEnvironment,
    ...extra,
    DATA_DIR: dataDir,
  });
  const database = openDatabase({ databasePath: config.databasePath });
  const app = authenticateTestRequests(await buildApp({ config, database }));

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

    expect(localResponse.json()).toMatchObject({ user: "user" });
    expect(forwardedResponse.json()).toMatchObject({ user: "alice" });

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
      promptModifiers: { shot: [", establishing shot"] },
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

  it("orders and deletes groups without deleting their sessions", async () => {
    const app = await createTestApp();
    const first = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "First" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Second" },
    });
    const firstId = first.json<{ id: string }>().id;
    const secondId = second.json<{ id: string }>().id;

    const groupResponse = await app.inject({
      method: "POST",
      url: "/api/session-groups",
      payload: { title: "Studies" },
    });
    const groupId = groupResponse.json<{ id: string }>().id;
    expect(groupResponse.statusCode).toBe(201);
    const secondGroupResponse = await app.inject({
      method: "POST",
      url: "/api/session-groups",
      payload: { title: "Finals" },
    });
    const secondGroupId = secondGroupResponse.json<{ id: string }>().id;

    const moveFirstResponse = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${firstId}/position`,
      payload: { groupId, beforeSessionId: null },
    });
    const moveSecondResponse = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${secondId}/position`,
      payload: { groupId, beforeSessionId: firstId },
    });
    expect(moveFirstResponse.statusCode).toBe(200);
    expect(moveSecondResponse.statusCode).toBe(200);
    expect(
      moveSecondResponse
        .json<Array<{ id: string; groupId: string; sortOrder: number }>>()
        .filter((session) => session.groupId === groupId),
    ).toEqual([
      expect.objectContaining({ id: secondId, sortOrder: 0 }),
      expect.objectContaining({ id: firstId, sortOrder: 1 }),
    ]);

    const groupsResponse = await app.inject({
      method: "GET",
      url: "/api/session-groups",
    });
    const groups =
      groupsResponse.json<Array<{ title: string; isArchived: boolean }>>();
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ title: "Studies", isArchived: false });
    expect(groups[1]).toMatchObject({ title: "Finals", isArchived: false });
    expect(groups[2]).toMatchObject({ title: "Archived", isArchived: true });

    const reorderResponse = await app.inject({
      method: "PATCH",
      url: `/api/session-groups/${secondGroupId}/position`,
      payload: { beforeGroupId: groupId },
    });
    expect(reorderResponse.statusCode).toBe(200);
    expect(
      reorderResponse.json<
        Array<{ id: string; isArchived: boolean; sortOrder: number }>
      >(),
    ).toEqual([
      expect.objectContaining({ id: secondGroupId, sortOrder: 0 }),
      expect.objectContaining({ id: groupId, sortOrder: 1 }),
      expect.objectContaining({ isArchived: true }),
    ]);

    const archivedId = groupsResponse
      .json<Array<{ id: string; isArchived: boolean }>>()
      .find((group) => group.isArchived)?.id;
    const archiveResponse = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${firstId}/position`,
      payload: { groupId: archivedId, beforeSessionId: null },
    });
    expect(archiveResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstId, groupId: archivedId }),
      ]),
    );

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/sessions",
    });
    expect(listResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstId, groupId: archivedId }),
        expect.objectContaining({ id: secondId, groupId }),
      ]),
    );

    const deleteGroupResponse = await app.inject({
      method: "DELETE",
      url: `/api/session-groups/${groupId}`,
    });
    expect(deleteGroupResponse.statusCode).toBe(200);
    expect(deleteGroupResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: secondId, groupId: null }),
        expect.objectContaining({ id: firstId, groupId: archivedId }),
      ]),
    );

    const groupsAfterDelete = await app.inject({
      method: "GET",
      url: "/api/session-groups",
    });
    expect(groupsAfterDelete.json()).toEqual([
      expect.objectContaining({ id: secondGroupId }),
      expect.objectContaining({ id: archivedId, isArchived: true }),
    ]);

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

  it("requires the public protocol for same-host origin fallback", async () => {
    const app = await createTestApp({
      PUBLIC_URL: "https://pictogen.example",
      TRUSTED_ORIGINS: "https://trusted.example:8443",
    });

    const sameProtocol = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { host: "lan.example", origin: "https://lan.example" },
      payload: { title: "Allowed by host" },
    });
    const wrongProtocol = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { host: "lan.example", origin: "http://lan.example" },
      payload: { title: "Blocked by protocol" },
    });
    const trustedOrigin = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: {
        host: "internal.example",
        origin: "https://trusted.example:8443",
      },
      payload: { title: "Allowed explicitly" },
    });
    const wrongTrustedPort = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: {
        host: "internal.example",
        origin: "https://trusted.example",
      },
      payload: { title: "Blocked by port" },
    });

    expect(sameProtocol.statusCode).toBe(201);
    expect(wrongProtocol.statusCode).toBe(403);
    expect(trustedOrigin.statusCode).toBe(201);
    expect(wrongTrustedPort.statusCode).toBe(403);

    await app.close();
  });
});
