import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { buildApp } from "../server/app.js";
import { createLoginFailureTracker, setLocalPassword } from "../server/auth.js";
import { parseConfig } from "../server/config.js";
import { openDatabase } from "../server/db.js";
import {
  authSessions,
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
});
