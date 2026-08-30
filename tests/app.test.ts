import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../server/app.js";
import { parseConfig } from "../server/config.js";
import { openDatabase } from "../server/db.js";
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

describe("application shell", () => {
  it("starts with migrations and reports database health", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "pictogen-"));
    temporaryDirectories.push(dataDir);
    const config = parseConfig({
      NODE_ENV: "test",
      OPENROUTER_API_KEY: "test-key",
      ...forwardAuthTestEnvironment,
      DATA_DIR: dataDir,
    });
    const database = openDatabase({
      databasePath: config.databasePath,
      migrationsFolder: resolve("drizzle"),
    });
    const app = authenticateTestRequests(await buildApp({ config, database }));

    const migrationTable = database.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
      )
      .pluck()
      .get();
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(migrationTable).toBe("__drizzle_migrations");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'self'",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");

    database.sqlite.close();
    const unavailableResponse = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(unavailableResponse.statusCode).toBe(503);
    expect(unavailableResponse.json()).toEqual({ status: "unhealthy" });

    await app.close();
  });

  it("returns the standard error shape for missing API routes", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "pictogen-"));
    temporaryDirectories.push(dataDir);
    const config = parseConfig({
      NODE_ENV: "test",
      OPENROUTER_API_KEY: "test-key",
      ...forwardAuthTestEnvironment,
      DATA_DIR: dataDir,
    });
    const database = openDatabase({ databasePath: config.databasePath });
    const app = authenticateTestRequests(await buildApp({ config, database }));

    const response = await app.inject({
      method: "GET",
      url: "/api/missing",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "RESOURCE_NOT_FOUND",
        message: "Resource not found.",
      },
    });

    await app.close();
  });

  it("serves the shared demo workspace without a provider or mutations", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "pictogen-"));
    temporaryDirectories.push(dataDir);
    const config = parseConfig({
      NODE_ENV: "test",
      AUTH_MODE: "demo",
      DATA_DIR: dataDir,
    });
    const database = openDatabase({ databasePath: config.databasePath });
    const app = await buildApp({
      config,
      database,
      provider: {
        id: "test",
        displayName: "Test",
        listImageModels: () => {
          throw new Error("The demo must not use an image provider.");
        },
      },
    });

    expect(
      (await app.inject({ method: "GET", url: "/api/auth/config" })).json(),
    ).toMatchObject({ mode: "demo" });
    expect(
      (await app.inject({ method: "GET", url: "/api/me" })).json(),
    ).toMatchObject({ user: "demo", isAdmin: false });

    const mutation = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Nope" },
    });
    expect(mutation.statusCode).toBe(403);
    expect(mutation.json()).toEqual({
      error: {
        code: "DEMO_READ_ONLY",
        message: "The demo workspace is read-only.",
      },
    });
    expect(
      (await app.inject({ method: "GET", url: "/api/models" })).json(),
    ).toMatchObject({ models: [], stale: false });

    await app.close();
  });
});
