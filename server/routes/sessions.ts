import { randomUUID } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import {
  ErrorResponseSchema,
  SessionDetailSchema,
  SessionDraftSchema,
  SessionGroupSchema,
  SessionSummarySchema,
  createEmptyDraft,
  normalizeSessionDraft,
} from "../../shared/contracts.js";
import type {
  SessionDetail,
  SessionDraft,
  SessionGroup,
  SessionSummary,
} from "../../shared/contracts.js";
import { resolveUser } from "../auth.js";
import type { AppDatabase } from "../db.js";
import {
  assets,
  generationJobs,
  generationRuns,
  sessionGroups,
  sessions,
} from "../db/schema.js";
import type { createAssetService } from "../services/assets.js";
import { runDetail } from "./generation.js";

const SessionParamsSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
});

const SessionGroupParamsSchema = Type.Object({
  groupId: Type.String({ minLength: 1 }),
});

const CreateSessionBodySchema = Type.Object(
  {
    title: Type.Optional(Type.String({ maxLength: 120 })),
  },
  { additionalProperties: false },
);

const SessionGroupBodySchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 120, pattern: "\\S" }),
  },
  { additionalProperties: false },
);

const UpdateSessionBodySchema = Type.Object(
  {
    title: Type.Optional(
      Type.String({ minLength: 1, maxLength: 120, pattern: "\\S" }),
    ),
    draft: Type.Optional(SessionDraftSchema),
  },
  { additionalProperties: false, minProperties: 1 },
);

const MoveSessionBodySchema = Type.Object(
  {
    groupId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    beforeSessionId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

const MoveSessionGroupBodySchema = Type.Object(
  {
    beforeGroupId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

type SessionParams = Static<typeof SessionParamsSchema>;
type CreateSessionBody = Static<typeof CreateSessionBodySchema>;
type UpdateSessionBody = Static<typeof UpdateSessionBodySchema>;
type MoveSessionBody = Static<typeof MoveSessionBodySchema>;
type MoveSessionGroupBody = Static<typeof MoveSessionGroupBodySchema>;
type SessionRow = typeof sessions.$inferSelect;
type SessionGroupRow = typeof sessionGroups.$inferSelect;

function summaryFromRow(
  database: AppDatabase,
  row: SessionRow,
): SessionSummary {
  const jobs = database.orm
    .select({
      status: generationJobs.status,
      costMicrousd: generationJobs.costMicrousd,
      costComplete: generationJobs.costComplete,
    })
    .from(generationJobs)
    .where(eq(generationJobs.sessionId, row.id))
    .all();
  const knownCosts = jobs
    .map((job) => job.costMicrousd)
    .filter((cost): cost is number => cost !== null);
  return {
    id: row.id,
    groupId: row.groupId,
    title: row.title,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    knownCostMicrousd: knownCosts.reduce((total, cost) => total + cost, 0),
    costComplete: jobs.every((job) => job.costComplete),
    activeJobCount: jobs.filter(
      (job) => job.status === "queued" || job.status === "running",
    ).length,
  };
}

function groupFromRow(row: SessionGroupRow): SessionGroup {
  return {
    id: row.id,
    title: row.title,
    isArchived: row.isArchived,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function findOwnedGroup(
  database: AppDatabase,
  groupId: string,
  ownerId: string,
) {
  return database.orm
    .select()
    .from(sessionGroups)
    .where(
      and(eq(sessionGroups.id, groupId), eq(sessionGroups.ownerId, ownerId)),
    )
    .get();
}

function ensureArchivedGroup(database: AppDatabase, ownerId: string) {
  const existing = database.orm
    .select()
    .from(sessionGroups)
    .where(
      and(
        eq(sessionGroups.ownerId, ownerId),
        eq(sessionGroups.isArchived, true),
      ),
    )
    .get();
  if (existing) return existing;

  const timestamp = new Date().toISOString();
  const row: SessionGroupRow = {
    id: randomUUID(),
    ownerId,
    title: "Archived",
    isArchived: true,
    sortOrder: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  database.orm.insert(sessionGroups).values(row).run();
  return row;
}

function orderedSessionGroups(database: AppDatabase, ownerId: string) {
  return database.orm
    .select()
    .from(sessionGroups)
    .where(eq(sessionGroups.ownerId, ownerId))
    .orderBy(
      asc(sessionGroups.isArchived),
      asc(sessionGroups.sortOrder),
      asc(sessionGroups.createdAt),
    )
    .all();
}

function detailFromRow(
  database: AppDatabase,
  row: SessionRow,
  references: SessionDetail["references"] = [],
): SessionDetail {
  return {
    ...summaryFromRow(database, row),
    draft: normalizeSessionDraft(JSON.parse(row.draftJson) as SessionDraft),
    references,
    runs: database.orm
      .select({ id: generationRuns.id })
      .from(generationRuns)
      .where(eq(generationRuns.sessionId, row.id))
      .orderBy(desc(generationRuns.createdAt))
      .all()
      .flatMap((run) => {
        const detail = runDetail(database, run.id);
        return detail ? [detail] : [];
      }),
  };
}

function findOwnedSession(
  database: AppDatabase,
  sessionId: string,
  ownerId: string,
) {
  return database.orm
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.ownerId, ownerId)))
    .get();
}

function orderedSessions(database: AppDatabase, ownerId: string) {
  return database.orm
    .select()
    .from(sessions)
    .where(eq(sessions.ownerId, ownerId))
    .orderBy(asc(sessions.sortOrder), desc(sessions.updatedAt))
    .all();
}

function sessionsInGroup(
  database: AppDatabase,
  ownerId: string,
  groupId: string | null,
) {
  return database.orm
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.ownerId, ownerId),
        groupId === null
          ? isNull(sessions.groupId)
          : eq(sessions.groupId, groupId),
      ),
    )
    .orderBy(asc(sessions.sortOrder), desc(sessions.updatedAt))
    .all();
}

export async function registerSessionRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  assetService: ReturnType<typeof createAssetService>,
) {
  app.get(
    "/api/session-groups",
    {
      schema: {
        response: {
          200: Type.Array(SessionGroupSchema),
        },
      },
    },
    (request) => {
      const ownerId = resolveUser(request);
      ensureArchivedGroup(database, ownerId);
      return orderedSessionGroups(database, ownerId).map(groupFromRow);
    },
  );

  app.post<{ Body: Static<typeof SessionGroupBodySchema> }>(
    "/api/session-groups",
    {
      schema: {
        body: SessionGroupBodySchema,
        response: {
          201: SessionGroupSchema,
        },
      },
    },
    (request, reply) => {
      const timestamp = new Date().toISOString();
      const ownerId = resolveUser(request);
      const normalGroups = orderedSessionGroups(database, ownerId).filter(
        (group) => !group.isArchived,
      );
      const row: SessionGroupRow = {
        id: randomUUID(),
        ownerId,
        title: request.body.title.trim(),
        isArchived: false,
        sortOrder:
          Math.max(0, ...normalGroups.map((group) => group.sortOrder)) + 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      database.orm.insert(sessionGroups).values(row).run();
      reply.code(201);
      return groupFromRow(row);
    },
  );

  app.patch<{
    Params: Static<typeof SessionGroupParamsSchema>;
    Body: Static<typeof SessionGroupBodySchema>;
  }>(
    "/api/session-groups/:groupId",
    {
      schema: {
        params: SessionGroupParamsSchema,
        body: SessionGroupBodySchema,
        response: {
          200: SessionGroupSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    (request, reply) => {
      const ownerId = resolveUser(request);
      const current = findOwnedGroup(database, request.params.groupId, ownerId);
      if (!current) {
        return reply.code(404).send({
          error: { code: "GROUP_NOT_FOUND", message: "Group not found." },
        });
      }
      if (current.isArchived) {
        return reply.code(400).send({
          error: {
            code: "GROUP_PROTECTED",
            message: "The Archived group cannot be changed.",
          },
        });
      }
      const updated: SessionGroupRow = {
        ...current,
        title: request.body.title.trim(),
        updatedAt: new Date().toISOString(),
      };
      database.orm
        .update(sessionGroups)
        .set({ title: updated.title, updatedAt: updated.updatedAt })
        .where(
          and(
            eq(sessionGroups.id, current.id),
            eq(sessionGroups.ownerId, ownerId),
          ),
        )
        .run();
      return groupFromRow(updated);
    },
  );

  app.patch<{
    Params: Static<typeof SessionGroupParamsSchema>;
    Body: MoveSessionGroupBody;
  }>(
    "/api/session-groups/:groupId/position",
    {
      schema: {
        params: SessionGroupParamsSchema,
        body: MoveSessionGroupBodySchema,
        response: {
          200: Type.Array(SessionGroupSchema),
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    (request, reply) => {
      const ownerId = resolveUser(request);
      const current = findOwnedGroup(database, request.params.groupId, ownerId);
      if (!current) {
        return reply.code(404).send({
          error: { code: "GROUP_NOT_FOUND", message: "Group not found." },
        });
      }
      if (current.isArchived) {
        return reply.code(400).send({
          error: {
            code: "GROUP_PROTECTED",
            message: "The Archived group cannot be moved.",
          },
        });
      }

      const destination = orderedSessionGroups(database, ownerId).filter(
        (group) => !group.isArchived && group.id !== current.id,
      );
      const beforeIndex =
        request.body.beforeGroupId === null
          ? destination.length
          : destination.findIndex(
              (group) => group.id === request.body.beforeGroupId,
            );
      if (beforeIndex < 0 || request.body.beforeGroupId === current.id) {
        return reply.code(400).send({
          error: {
            code: "GROUP_POSITION_INVALID",
            message: "The requested group position is invalid.",
          },
        });
      }

      destination.splice(beforeIndex, 0, current);
      database.sqlite.transaction(() => {
        for (const [sortOrder, group] of destination.entries()) {
          database.orm
            .update(sessionGroups)
            .set({ sortOrder })
            .where(
              and(
                eq(sessionGroups.id, group.id),
                eq(sessionGroups.ownerId, ownerId),
              ),
            )
            .run();
        }
      })();

      return orderedSessionGroups(database, ownerId).map(groupFromRow);
    },
  );

  app.delete<{ Params: Static<typeof SessionGroupParamsSchema> }>(
    "/api/session-groups/:groupId",
    {
      schema: {
        params: SessionGroupParamsSchema,
        response: {
          200: Type.Array(SessionSummarySchema),
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    (request, reply) => {
      const ownerId = resolveUser(request);
      const current = findOwnedGroup(database, request.params.groupId, ownerId);
      if (!current) {
        return reply.code(404).send({
          error: { code: "GROUP_NOT_FOUND", message: "Group not found." },
        });
      }
      if (current.isArchived) {
        return reply.code(400).send({
          error: {
            code: "GROUP_PROTECTED",
            message: "The Archived group cannot be deleted.",
          },
        });
      }

      const destination = [
        ...sessionsInGroup(database, ownerId, null),
        ...sessionsInGroup(database, ownerId, current.id),
      ];
      database.sqlite.transaction(() => {
        for (const [sortOrder, session] of destination.entries()) {
          database.orm
            .update(sessions)
            .set({ groupId: null, sortOrder })
            .where(
              and(eq(sessions.id, session.id), eq(sessions.ownerId, ownerId)),
            )
            .run();
        }
        database.orm
          .delete(sessionGroups)
          .where(
            and(
              eq(sessionGroups.id, current.id),
              eq(sessionGroups.ownerId, ownerId),
            ),
          )
          .run();
      })();

      return orderedSessions(database, ownerId).map((row) =>
        summaryFromRow(database, row),
      );
    },
  );

  app.get(
    "/api/me",
    {
      schema: {
        response: {
          200: Type.Object({
            id: Type.String(),
            user: Type.String(),
            isAdmin: Type.Boolean(),
            mustChangePassword: Type.Boolean(),
          }),
        },
      },
    },
    (request) => ({
      id: resolveUser(request),
      user: request.authUser?.displayName ?? resolveUser(request),
      isAdmin: request.authUser?.isAdmin ?? false,
      mustChangePassword: request.authUser?.mustChangePassword ?? false,
    }),
  );

  app.get(
    "/api/sessions",
    {
      schema: {
        response: {
          200: Type.Array(SessionSummarySchema),
        },
      },
    },
    (request) =>
      orderedSessions(database, resolveUser(request)).map((row) =>
        summaryFromRow(database, row),
      ),
  );

  app.post<{ Body: CreateSessionBody }>(
    "/api/sessions",
    {
      schema: {
        body: CreateSessionBodySchema,
        response: {
          201: SessionDetailSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    (request, reply) => {
      const timestamp = new Date().toISOString();
      const ownerId = resolveUser(request);
      const row: SessionRow = {
        id: randomUUID(),
        ownerId,
        groupId: null,
        title: request.body.title?.trim() || "Untitled session",
        draftJson: JSON.stringify(createEmptyDraft()),
        sortOrder:
          Math.min(
            0,
            ...sessionsInGroup(database, ownerId, null).map(
              (session) => session.sortOrder,
            ),
          ) - 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      database.orm.insert(sessions).values(row).run();
      reply.code(201);
      return detailFromRow(
        database,
        row,
        assetService.listReferences(row.id, ownerId),
      );
    },
  );

  app.get<{ Params: SessionParams }>(
    "/api/sessions/:sessionId",
    {
      schema: {
        params: SessionParamsSchema,
        response: {
          200: SessionDetailSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    (request, reply) => {
      const row = findOwnedSession(
        database,
        request.params.sessionId,
        resolveUser(request),
      );

      if (!row) {
        return reply.code(404).send({
          error: {
            code: "SESSION_NOT_FOUND",
            message: "Session not found.",
          },
        });
      }

      return detailFromRow(
        database,
        row,
        assetService.listReferences(row.id, resolveUser(request)),
      );
    },
  );

  app.patch<{ Params: SessionParams; Body: UpdateSessionBody }>(
    "/api/sessions/:sessionId",
    {
      schema: {
        params: SessionParamsSchema,
        body: UpdateSessionBodySchema,
        response: {
          200: SessionDetailSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ownerId = resolveUser(request);
      const current = findOwnedSession(
        database,
        request.params.sessionId,
        ownerId,
      );

      if (!current) {
        return reply.code(404).send({
          error: {
            code: "SESSION_NOT_FOUND",
            message: "Session not found.",
          },
        });
      }

      if (request.body.draft?.referenceAssetIds.length) {
        const references = database.orm
          .select({ id: assets.id })
          .from(assets)
          .where(
            and(
              eq(assets.ownerId, ownerId),
              eq(assets.sessionId, current.id),
              inArray(assets.id, request.body.draft.referenceAssetIds),
            ),
          )
          .all();
        if (references.length !== request.body.draft.referenceAssetIds.length) {
          return reply.code(400).send({
            error: {
              code: "ASSET_INVALID",
              message: "One or more reference images are unavailable.",
            },
          });
        }
      }

      const updated: SessionRow = {
        ...current,
        title: request.body.title?.trim() ?? current.title,
        draftJson: request.body.draft
          ? JSON.stringify(request.body.draft)
          : current.draftJson,
        updatedAt: new Date().toISOString(),
      };

      database.orm
        .update(sessions)
        .set({
          title: updated.title,
          draftJson: updated.draftJson,
          updatedAt: updated.updatedAt,
        })
        .where(and(eq(sessions.id, current.id), eq(sessions.ownerId, ownerId)))
        .run();

      return detailFromRow(
        database,
        updated,
        assetService.listReferences(updated.id, ownerId),
      );
    },
  );

  app.patch<{ Params: SessionParams; Body: MoveSessionBody }>(
    "/api/sessions/:sessionId/position",
    {
      schema: {
        params: SessionParamsSchema,
        body: MoveSessionBodySchema,
        response: {
          200: Type.Array(SessionSummarySchema),
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    (request, reply) => {
      const ownerId = resolveUser(request);
      const current = findOwnedSession(
        database,
        request.params.sessionId,
        ownerId,
      );
      if (!current) {
        return reply.code(404).send({
          error: { code: "SESSION_NOT_FOUND", message: "Session not found." },
        });
      }
      if (
        request.body.groupId !== null &&
        !findOwnedGroup(database, request.body.groupId, ownerId)
      ) {
        return reply.code(404).send({
          error: { code: "GROUP_NOT_FOUND", message: "Group not found." },
        });
      }

      const destination = sessionsInGroup(
        database,
        ownerId,
        request.body.groupId,
      ).filter((session) => session.id !== current.id);
      const beforeIndex =
        request.body.beforeSessionId === null
          ? destination.length
          : destination.findIndex(
              (session) => session.id === request.body.beforeSessionId,
            );
      if (beforeIndex < 0 || request.body.beforeSessionId === current.id) {
        return reply.code(400).send({
          error: {
            code: "SESSION_POSITION_INVALID",
            message: "The requested session position is invalid.",
          },
        });
      }

      destination.splice(beforeIndex, 0, {
        ...current,
        groupId: request.body.groupId,
      });
      database.sqlite.transaction(() => {
        for (const [sortOrder, session] of destination.entries()) {
          database.orm
            .update(sessions)
            .set({ groupId: request.body.groupId, sortOrder })
            .where(
              and(eq(sessions.id, session.id), eq(sessions.ownerId, ownerId)),
            )
            .run();
        }
      })();

      return orderedSessions(database, ownerId).map((row) =>
        summaryFromRow(database, row),
      );
    },
  );

  app.delete<{ Params: SessionParams }>(
    "/api/sessions/:sessionId",
    {
      schema: {
        params: SessionParamsSchema,
        response: {
          204: Type.Null(),
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ownerId = resolveUser(request);
      const row = findOwnedSession(database, request.params.sessionId, ownerId);

      if (!row) {
        return reply.code(404).send({
          error: {
            code: "SESSION_NOT_FOUND",
            message: "Session not found.",
          },
        });
      }

      const sessionAssets = database.orm
        .select({ storagePath: assets.storagePath })
        .from(assets)
        .where(and(eq(assets.sessionId, row.id), eq(assets.ownerId, ownerId)))
        .all();

      database.orm
        .delete(sessions)
        .where(and(eq(sessions.id, row.id), eq(sessions.ownerId, ownerId)))
        .run();
      await Promise.all(
        sessionAssets.map((asset) =>
          assetService.removeFile(asset.storagePath),
        ),
      );
      return reply.code(204).send(null);
    },
  );
}
