import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { buildApp } from "../server/app.js";
import { createLoginFailureTracker, setLocalPassword } from "../server/auth.js";
import { parseConfig } from "../server/config.js";
import { openDatabase } from "../server/db.js";
import {
  assets,
  authSessions,
  generationJobs,
  generationRuns,
  jobReferences,
  localCredentials,
  sessions,
  users,
} from "../server/db/schema.js";

const adminPassword = "correct-horse-battery";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function dataDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "pictogen-auth-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function buildLocalApp(
  dataDir = dataDirectory(),
  extra: NodeJS.ProcessEnv = {},
) {
  const config = parseConfig({
    NODE_ENV: "test",
    OPENROUTER_API_KEY: "test-key",
    AUTH_MODE: "local",
    ADMIN_USERNAME: "owner",
    ADMIN_PASSWORD: adminPassword,
    PUBLIC_URL: "http://localhost:3000",
    ...extra,
    DATA_DIR: dataDir,
  });
  const database = openDatabase({ databasePath: config.databasePath });
  const app = await buildApp({ config, database });
  return { app, database, dataDir };
}

async function buildForwardApp(
  dataDir = dataDirectory(),
  extra: NodeJS.ProcessEnv = {},
) {
  const config = parseConfig({
    NODE_ENV: "test",
    OPENROUTER_API_KEY: "test-key",
    AUTH_MODE: "forward-auth",
    FORWARD_AUTH_TRUSTED_PROXIES: "127.0.0.1",
    PUBLIC_URL: "http://localhost:3000",
    ...extra,
    DATA_DIR: dataDir,
  });
  const database = openDatabase({ databasePath: config.databasePath });
  const app = await buildApp({ config, database });
  return { app, database, dataDir };
}

function cookieFrom(response: { headers: Record<string, unknown> }) {
  const value = response.headers["set-cookie"];
  const header = Array.isArray(value) ? value[0] : String(value);
  return header.split(";", 1)[0] ?? "";
}

async function signIn(
  app: Awaited<ReturnType<typeof buildLocalApp>>["app"],
  username: string,
  password: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
  return { response, cookie: cookieFrom(response) };
}

describe("local authentication", () => {
  it("protects APIs, seeds an Argon2id administrator, and ignores proxy headers", async () => {
    const { app, database } = await buildLocalApp(undefined, {
      PUBLIC_URL: "https://pictogen.example",
    });

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/me",
          headers: { "remote-user": "forged" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/api/auth/config" })).json(),
    ).toEqual({ mode: "local", minimumPasswordLength: 8 });

    const credential = database.orm.select().from(localCredentials).get();
    expect(credential?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(credential?.passwordHash).not.toContain(adminPassword);

    const { response, cookie } = await signIn(app, " OWNER ", adminPassword);
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("Secure");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(
      (
        await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })
      ).json(),
    ).toMatchObject({
      user: "owner",
      isAdmin: true,
      mustChangePassword: false,
    });

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toContain("Secure");
    expect(logout.headers["set-cookie"]).toContain("HttpOnly");
    expect(logout.headers["set-cookie"]).toContain("Path=/");
    expect(
      (await app.inject({ method: "GET", url: "/api/me", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
    await app.close();
  });

  it("requires generated passwords to change and revokes every old session", async () => {
    const { app, database } = await buildLocalApp(undefined, {
      ADMIN_PASSWORD: undefined,
    });
    const credential = database.orm.select().from(localCredentials).get();
    expect(credential?.mustChangePassword).toBe(true);
    if (!credential) return;
    await setLocalPassword(database, credential.userId, "temporary-pass", true);

    const first = await signIn(app, "owner", "temporary-pass");
    const second = await signIn(app, "owner", "temporary-pass");
    expect(first.response.statusCode).toBe(200);
    expect(second.response.statusCode).toBe(200);
    expect(database.orm.select().from(authSessions).all()).toHaveLength(2);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/sessions",
          headers: { cookie: first.cookie },
        })
      ).statusCode,
    ).toBe(403);

    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie: first.cookie },
      payload: {
        currentPassword: "temporary-pass",
        newPassword: "a-brand-new-password",
      },
    });
    expect(changed.statusCode).toBe(204);
    for (const cookie of [first.cookie, second.cookie]) {
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/me",
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(401);
    }
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/sessions",
          headers: { cookie: cookieFrom(changed) },
        })
      ).statusCode,
    ).toBe(200);
    expect(database.orm.select().from(authSessions).all()).toHaveLength(1);
    await app.close();
  });

  it("attaches bootstrap and created credentials to existing stable users", async () => {
    const dataDir = dataDirectory();
    const config = parseConfig({
      NODE_ENV: "test",
      OPENROUTER_API_KEY: "test-key",
      AUTH_MODE: "local",
      ADMIN_USERNAME: "OWNER",
      ADMIN_PASSWORD: adminPassword,
      DATA_DIR: dataDir,
    });
    const database = openDatabase({ databasePath: config.databasePath });
    const now = new Date().toISOString();
    database.orm
      .insert(users)
      .values({
        id: "stable-owner",
        username: "owner",
        displayName: "Owner",
        isAdmin: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.orm
      .insert(users)
      .values({
        id: "stable-artist",
        username: "artist",
        displayName: "Artist",
        isAdmin: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.orm
      .insert(sessions)
      .values({
        id: "existing-session",
        ownerId: "stable-artist",
        title: "Existing",
        draftJson: "{}",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const app = await buildApp({ config, database });
    const owner = await signIn(app, "owner", adminPassword);
    expect(owner.response.statusCode).toBe(200);
    expect(database.orm.select().from(users).all()).toHaveLength(2);
    expect(
      database.orm.select().from(users).where(eq(users.username, "owner")).get()
        ?.id,
    ).toBe("stable-owner");

    const created = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: owner.cookie },
      payload: {
        username: "ARTIST",
        password: "artist-long-password",
        isAdmin: false,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: "stable-artist" });
    expect(database.orm.select().from(users).all()).toHaveLength(2);

    const artist = await signIn(app, "artist", "artist-long-password");
    expect(artist.response.statusCode).toBe(200);
    const listed = await app.inject({
      method: "GET",
      url: "/api/sessions",
      headers: { cookie: artist.cookie },
    });
    expect(listed.json()).toEqual([
      expect.objectContaining({ id: "existing-session" }),
    ]);
    await app.close();
  });

  it("bounds live login failure entries", () => {
    const tracker = createLoginFailureTracker();
    for (let index = 0; index < 1_200; index += 1) {
      tracker.record(`unknown-${index}`);
    }
    expect(tracker.size).toBe(1_000);
  });

  it("grants and withdraws administrator access without losing the last administrator", async () => {
    const { app, database } = await buildLocalApp();
    const owner = await signIn(app, "owner", adminPassword);
    const created = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: owner.cookie },
      payload: { username: "artist", password: "artist-password" },
    });
    const artistId = created.json<{ id: string }>().id;
    const artist = await signIn(app, "artist", "artist-password");

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/users",
          headers: { cookie: artist.cookie },
        })
      ).statusCode,
    ).toBe(403);

    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/users/${artistId}`,
          headers: { cookie: owner.cookie },
          payload: { isAdmin: true },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/users",
          headers: { cookie: artist.cookie },
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/users/${artistId}`,
          headers: { cookie: owner.cookie },
          payload: { isAdmin: false },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/users",
          headers: { cookie: artist.cookie },
        })
      ).statusCode,
    ).toBe(403);

    const ownerId = database.orm
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, "owner"))
      .get()?.id;
    expect(ownerId).toBeDefined();
    if (!ownerId) return;
    const demotion = await app.inject({
      method: "PATCH",
      url: `/api/users/${ownerId}`,
      headers: { cookie: owner.cookie },
      payload: { isAdmin: false },
    });
    expect(demotion.statusCode).toBe(409);
    expect(demotion.json()).toMatchObject({
      error: { code: "LAST_ADMIN_REQUIRED" },
    });

    const removal = await app.inject({
      method: "DELETE",
      url: `/api/users/${ownerId}`,
      headers: { cookie: owner.cookie },
    });
    expect(removal.statusCode).toBe(409);
    expect(removal.json()).toMatchObject({
      error: { code: "SELF_REMOVAL_FORBIDDEN" },
    });
    await app.close();
  });

  it("deletes an account's records, sessions, originals, and thumbnails", async () => {
    const { app, database, dataDir } = await buildLocalApp();
    const owner = await signIn(app, "owner", adminPassword);
    const created = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: owner.cookie },
      payload: { username: "artist", password: "artist-password" },
    });
    const artistId = created.json<{ id: string }>().id;
    const artist = await signIn(app, "artist", "artist-password");
    const session = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie: artist.cookie },
      payload: { title: "Owned work" },
    });
    const sessionId = session.json<{ id: string }>().id;
    const now = new Date().toISOString();
    database.orm
      .insert(generationRuns)
      .values({
        id: "owned-run",
        sessionId,
        ownerId: artistId,
        idempotencyKey: "owned-key",
        prompt: "prompt",
        optionsJson: "{}",
        requestedCount: 1,
        createdAt: now,
      })
      .run();
    database.orm
      .insert(generationJobs)
      .values({
        id: "owned-job",
        runId: "owned-run",
        sessionId,
        ownerId: artistId,
        queueOrder: 1,
        providerId: "provider",
        modelId: "model",
        modelName: "Model",
        effectiveOptionsJson: "{}",
        requestedCount: 1,
        completedCount: 1,
        status: "succeeded",
        usageJson: "[]",
        costMicrousd: 1,
        costComplete: true,
        errorCode: null,
        errorMessage: null,
        hiddenAt: null,
        startedAt: now,
        finishedAt: now,
        createdAt: now,
      })
      .run();
    database.orm
      .insert(assets)
      .values({
        id: "owned-asset",
        ownerId: artistId,
        sessionId,
        jobId: "owned-job",
        kind: "output",
        sha256: "hash",
        storagePath: "owned-output.png",
        mimeType: "image/png",
        bytes: 4,
        width: 1,
        height: 1,
        blurHash: null,
        starred: false,
        ordinal: 0,
        createdAt: now,
      })
      .run();
    database.orm
      .insert(jobReferences)
      .values({ jobId: "owned-job", assetId: "owned-asset", ordinal: 0 })
      .run();

    const assetsDirectory = join(dataDir, "assets");
    const originalPath = join(assetsDirectory, "owned-output.png");
    const thumbnailPath = join(assetsDirectory, "owned-output-thumb.webp");
    mkdirSync(assetsDirectory, { recursive: true });
    writeFileSync(originalPath, "file");
    writeFileSync(thumbnailPath, "thumbnail");

    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/users/${artistId}`,
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(204);
    expect(database.orm.select().from(users).all()).toHaveLength(1);
    expect(database.orm.select().from(localCredentials).all()).toHaveLength(1);
    expect(database.orm.select().from(authSessions).all()).toHaveLength(1);
    expect(database.orm.select().from(sessions).all()).toHaveLength(0);
    expect(database.orm.select().from(assets).all()).toHaveLength(0);
    expect(database.orm.select().from(generationRuns).all()).toHaveLength(0);
    expect(database.orm.select().from(generationJobs).all()).toHaveLength(0);
    expect(database.orm.select().from(jobReferences).all()).toHaveLength(0);
    expect(existsSync(originalPath)).toBe(false);
    expect(existsSync(thumbnailPath)).toBe(false);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/me",
          headers: { cookie: artist.cookie },
        })
      ).statusCode,
    ).toBe(401);
    await app.close();
  });
});

describe("ForwardAuth", () => {
  it("uses one configured header from explicitly trusted direct peers", async () => {
    const trusted = await buildForwardApp(undefined, {
      FORWARD_AUTH_USER_HEADER: "X-Authenticated-User",
      FORWARD_AUTH_TRUSTED_PROXIES: "127.0.0.0/24",
    });
    expect(
      (
        await trusted.app.inject({
          method: "GET",
          url: "/api/me",
          headers: { "remote-user": "wrong-header" },
        })
      ).statusCode,
    ).toBe(401);
    const accepted = await trusted.app.inject({
      method: "GET",
      url: "/api/me",
      headers: { "x-authenticated-user": " Alice " },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ user: "Alice", isAdmin: false });
    expect(trusted.database.orm.select().from(users).get()).toMatchObject({
      username: "alice",
      isAdmin: false,
    });
    expect(
      (
        await trusted.app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { "x-authenticated-user": "alice" },
        })
      ).statusCode,
    ).toBe(404);
    await trusted.app.close();

    const untrusted = await buildForwardApp(undefined, {
      FORWARD_AUTH_USER_HEADER: "X-Authenticated-User",
      FORWARD_AUTH_TRUSTED_PROXIES: "10.0.0.0/24",
    });
    expect(
      (
        await untrusted.app.inject({
          method: "GET",
          url: "/api/me",
          headers: {
            "x-authenticated-user": "forged",
            "x-forwarded-for": "10.0.0.10",
          },
        })
      ).statusCode,
    ).toBe(401);
    expect(untrusted.database.orm.select().from(users).all()).toHaveLength(0);
    await untrusted.app.close();
  });

  it("preserves stable ownership when switching from ForwardAuth to local", async () => {
    const dataDir = dataDirectory();
    const forwarded = await buildForwardApp(dataDir);
    const identity = await forwarded.app.inject({
      method: "GET",
      url: "/api/me",
      headers: { "remote-user": " Bob " },
    });
    const userId = identity.json<{ id: string }>().id;
    const created = await forwarded.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { "remote-user": "bob" },
      payload: { title: "Forwarded work" },
    });
    expect(created.statusCode).toBe(201);
    await forwarded.app.close();

    const local = await buildLocalApp(dataDir, {
      ADMIN_USERNAME: "BOB",
      ADMIN_PASSWORD: adminPassword,
    });
    const signedIn = await signIn(local.app, "bOb", adminPassword);
    expect(signedIn.response.statusCode).toBe(200);
    expect(
      (
        await local.app.inject({
          method: "GET",
          url: "/api/me",
          headers: { cookie: signedIn.cookie },
        })
      ).json(),
    ).toMatchObject({ id: userId, user: "Bob" });
    expect(
      (
        await local.app.inject({
          method: "GET",
          url: "/api/sessions",
          headers: { cookie: signedIn.cookie },
        })
      ).json(),
    ).toEqual([expect.objectContaining({ title: "Forwarded work" })]);
    expect(local.database.orm.select().from(users).all()).toHaveLength(1);
    await local.app.close();
  });

  it("ignores cookies, clears local sessions, and preserves ownership after switching", async () => {
    const dataDir = dataDirectory();
    const local = await buildLocalApp(dataDir, {
      ADMIN_USERNAME: "Bob",
      ADMIN_PASSWORD: adminPassword,
    });
    const signedIn = await signIn(local.app, "bob", adminPassword);
    const userId = local.database.orm
      .select({ id: users.id })
      .from(users)
      .get()?.id;
    expect(userId).toBeDefined();
    if (!userId) return;
    const created = await local.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie: signedIn.cookie },
      payload: { title: "Local work" },
    });
    expect(created.statusCode).toBe(201);
    expect(local.database.orm.select().from(authSessions).all()).toHaveLength(
      1,
    );
    await local.app.close();

    const forwarded = await buildForwardApp(dataDir);
    expect(
      forwarded.database.orm.select().from(authSessions).all(),
    ).toHaveLength(0);
    expect(
      (
        await forwarded.app.inject({
          method: "GET",
          url: "/api/me",
          headers: { cookie: signedIn.cookie },
        })
      ).statusCode,
    ).toBe(401);
    const accepted = await forwarded.app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: signedIn.cookie, "remote-user": "BOB" },
    });
    expect(accepted.json()).toMatchObject({ id: userId, user: "Bob" });
    expect(
      (
        await forwarded.app.inject({
          method: "GET",
          url: "/api/sessions",
          headers: { "remote-user": "bob" },
        })
      ).json(),
    ).toEqual([expect.objectContaining({ title: "Local work" })]);
    expect(forwarded.database.orm.select().from(users).all()).toHaveLength(1);
    await forwarded.app.close();
  });
});
