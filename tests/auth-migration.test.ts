import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../server/db.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function legacyMigrations(directory: string): string {
  const migrationsFolder = join(directory, "drizzle");
  mkdirSync(join(migrationsFolder, "meta"), { recursive: true });

  const journal = JSON.parse(
    readFileSync(resolve("drizzle/meta/_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> };
  writeFileSync(
    join(migrationsFolder, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, 8) }),
  );

  for (let index = 0; index < 8; index += 1) {
    const entry = journal.entries[index];
    if (!entry) throw new Error(`Missing migration ${index}.`);
    const tag = entry.tag;
    cpSync(resolve(`drizzle/${tag}.sql`), join(migrationsFolder, `${tag}.sql`));
  }

  return migrationsFolder;
}

describe("authentication migration", () => {
  it("preserves owners and merges usernames that differ only by case", () => {
    const directory = mkdtempSync(join(tmpdir(), "pictogen-auth-migration-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "pictogen.sqlite");
    const database = openDatabase({
      databasePath,
      migrationsFolder: legacyMigrations(directory),
    });

    const insertSession = database.sqlite.prepare(
      `insert into sessions
        (id, owner_id, title, draft_json, created_at, updated_at)
       values (?, ?, ?, '{}', ?, ?)`,
    );
    insertSession.run("session-bob-upper", "Bob", "Upper", "now", "now");
    insertSession.run("session-bob-lower", "bob", "Lower", "now", "now");
    insertSession.run("session-alice", "Alice", "Alice", "now", "now");

    database.sqlite
      .prepare(
        `insert into generation_runs
          (id, session_id, owner_id, idempotency_key, prompt, options_json,
           requested_count, created_at)
         values (?, ?, ?, 'same-key', 'prompt', '{}', 1, 'now')`,
      )
      .run("run-upper", "session-bob-upper", "Bob");
    database.sqlite
      .prepare(
        `insert into generation_runs
          (id, session_id, owner_id, idempotency_key, prompt, options_json,
           requested_count, created_at)
         values (?, ?, ?, 'same-key', 'prompt', '{}', 1, 'now')`,
      )
      .run("run-lower", "session-bob-lower", "bob");
    database.sqlite
      .prepare(
        `insert into generation_jobs
          (id, run_id, session_id, owner_id, queue_order, provider_id, model_id,
           model_name, effective_options_json, requested_count, completed_count,
           status, usage_json, cost_microusd, cost_complete, error_code,
           error_message, hidden_at, started_at, finished_at, created_at)
         values
          ('job-lower', 'run-lower', 'session-bob-lower', 'bob', 1,
           'provider', 'model', 'Model', '{}', 1, 0, 'queued', '[]', null,
           true, null, null, null, null, null, 'now')`,
      )
      .run();
    database.sqlite
      .prepare(
        `insert into assets
          (id, owner_id, session_id, job_id, kind, sha256, storage_path,
           mime_type, bytes, width, height, blur_hash, starred, ordinal,
           created_at)
         values
          ('asset-lower', 'bob', 'session-bob-lower', null, 'reference',
           'hash', 'assets/original.png', 'image/png', 1, 1, 1, null, false,
           null, 'now')`,
      )
      .run();
    database.close();

    const migrated = openDatabase({ databasePath });
    const users = migrated.sqlite
      .prepare("select id, username from users order by username")
      .all();

    expect(users).toEqual([
      { id: "Alice", username: "alice" },
      { id: "Bob", username: "bob" },
    ]);
    expect(
      migrated.sqlite
        .prepare("select distinct owner_id from sessions order by owner_id")
        .pluck()
        .all(),
    ).toEqual(["Alice", "Bob"]);
    expect(
      migrated.sqlite
        .prepare("select distinct owner_id from assets")
        .pluck()
        .all(),
    ).toEqual(["Bob"]);
    expect(
      migrated.sqlite
        .prepare("select distinct owner_id from generation_runs")
        .pluck()
        .all(),
    ).toEqual(["Bob"]);
    expect(
      migrated.sqlite
        .prepare("select distinct owner_id from generation_jobs")
        .pluck()
        .all(),
    ).toEqual(["Bob"]);
    expect(
      migrated.sqlite
        .prepare("select idempotency_key from generation_runs")
        .pluck()
        .all(),
    ).toHaveLength(2);
    expect(
      new Set(
        migrated.sqlite
          .prepare("select idempotency_key from generation_runs")
          .pluck()
          .all(),
      ).size,
    ).toBe(2);
    expect(migrated.sqlite.prepare("pragma foreign_key_check").all()).toEqual(
      [],
    );

    migrated.close();
  });
});
