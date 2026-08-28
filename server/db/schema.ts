import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    kind: text("kind", { enum: ["reference", "output"] }).notNull(),
    sha256: text("sha256").notNull(),
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type", {
      enum: ["image/png", "image/jpeg", "image/webp"],
    }).notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("assets_owner_created_idx").on(table.ownerId, table.createdAt),
    index("assets_session_kind_created_idx").on(
      table.sessionId,
      table.kind,
      table.createdAt,
    ),
  ],
);
