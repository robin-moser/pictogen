import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

export type AppDatabase = ReturnType<typeof openDatabase>;

type OpenDatabaseOptions = {
  databasePath: string;
  migrationsFolder?: string;
};

export function openDatabase({
  databasePath,
  migrationsFolder = resolve("drizzle"),
}: OpenDatabaseOptions) {
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new BetterSqlite3(databasePath);

  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
    migrate(drizzle(sqlite), { migrationsFolder });
  } catch (error) {
    sqlite.close();
    throw error;
  }

  return {
    sqlite,
    isHealthy() {
      try {
        return sqlite.prepare("select 1 as healthy").pluck().get() === 1;
      } catch {
        return false;
      }
    },
    close() {
      if (sqlite.open) {
        sqlite.close();
      }
    },
  };
}
