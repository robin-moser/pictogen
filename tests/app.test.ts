import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../server/app.js";
import { parseConfig } from "../server/config.js";
import { openDatabase } from "../server/db.js";

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
      DATA_DIR: dataDir,
    });
    const database = openDatabase({
      databasePath: config.databasePath,
      migrationsFolder: resolve("drizzle"),
    });
    const app = await buildApp({ config, database });

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
      DATA_DIR: dataDir,
    });
    const database = openDatabase({ databasePath: config.databasePath });
    const app = await buildApp({ config, database });

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
});
