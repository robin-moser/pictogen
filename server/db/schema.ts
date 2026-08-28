import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    draftJson: text("draft_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("sessions_owner_updated_idx").on(table.ownerId, table.updatedAt),
  ],
);

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    jobId: text("job_id").references(() => generationJobs.id, {
      onDelete: "cascade",
    }),
    kind: text("kind", { enum: ["reference", "output"] }).notNull(),
    sha256: text("sha256").notNull(),
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type", {
      enum: ["image/png", "image/jpeg", "image/webp"],
    }).notNull(),
    bytes: integer("bytes").notNull(),
    ordinal: integer("ordinal"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("assets_owner_created_idx").on(table.ownerId, table.createdAt),
    index("assets_session_kind_created_idx").on(
      table.sessionId,
      table.kind,
      table.createdAt,
    ),
    index("assets_job_ordinal_idx").on(table.jobId, table.ordinal),
  ],
);

export const generationRuns = sqliteTable(
  "generation_runs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    prompt: text("prompt").notNull(),
    optionsJson: text("options_json").notNull(),
    requestedCount: integer("requested_count").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    unique("generation_runs_owner_idempotency_key_unique").on(
      table.ownerId,
      table.idempotencyKey,
    ),
  ],
);

export const generationJobs = sqliteTable(
  "generation_jobs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => generationRuns.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    queueOrder: integer("queue_order").notNull(),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    modelName: text("model_name").notNull(),
    effectiveOptionsJson: text("effective_options_json").notNull(),
    requestedCount: integer("requested_count").notNull(),
    completedCount: integer("completed_count").notNull().default(0),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed", "cancelled"],
    }).notNull(),
    usageJson: text("usage_json").notNull(),
    costMicrousd: integer("cost_microusd"),
    costComplete: integer("cost_complete", { mode: "boolean" }).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    hiddenAt: text("hidden_at"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("generation_jobs_status_queue_idx").on(
      table.status,
      table.queueOrder,
    ),
    index("generation_jobs_session_created_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    index("generation_jobs_owner_status_idx").on(table.ownerId, table.status),
  ],
);

export const jobReferences = sqliteTable(
  "job_references",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => generationJobs.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.assetId] }),
    unique("job_references_job_ordinal_unique").on(table.jobId, table.ordinal),
  ],
);
