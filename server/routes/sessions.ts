import { randomUUID } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import {
  ErrorResponseSchema,
  SessionDetailSchema,
  SessionDraftSchema,
  SessionSummarySchema,
  createEmptyDraft,
  normalizeSessionDraft,
} from "../../shared/contracts.js";
import type {
  SessionDetail,
  SessionDraft,
  SessionSummary,
} from "../../shared/contracts.js";
import { resolveUser } from "../auth.js";
import type { AppDatabase } from "../db.js";
import {
  assets,
  generationJobs,
  generationRuns,
  sessions,
} from "../db/schema.js";
import type { createAssetService } from "../services/assets.js";
import { runDetail } from "./generation.js";

const SessionParamsSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
});

const CreateSessionBodySchema = Type.Object(
  {
    title: Type.Optional(Type.String({ maxLength: 120 })),
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

type SessionParams = Static<typeof SessionParamsSchema>;
type CreateSessionBody = Static<typeof CreateSessionBodySchema>;
type UpdateSessionBody = Static<typeof UpdateSessionBodySchema>;
type SessionRow = typeof sessions.$inferSelect;

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
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    knownCostMicrousd: knownCosts.reduce((total, cost) => total + cost, 0),
    costComplete: jobs.every((job) => job.costComplete),
    activeJobCount: jobs.filter(
      (job) => job.status === "queued" || job.status === "running",
    ).length,
  };
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

export async function registerSessionRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  assetService: ReturnType<typeof createAssetService>,
) {
  app.get(
    "/api/me",
    {
      schema: {
        response: {
          200: Type.Object({ user: Type.String() }),
        },
      },
    },
    (request) => ({ user: resolveUser(request) }),
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
      database.orm
        .select()
        .from(sessions)
        .where(eq(sessions.ownerId, resolveUser(request)))
        .orderBy(desc(sessions.updatedAt))
        .all()
        .map((row) => summaryFromRow(database, row)),
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
      const row: SessionRow = {
        id: randomUUID(),
        ownerId: resolveUser(request),
        title: request.body.title?.trim() || "Untitled session",
        draftJson: JSON.stringify(createEmptyDraft()),
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      database.orm.insert(sessions).values(row).run();
      reply.code(201);
      return detailFromRow(
        database,
        row,
        assetService.listReferences(row.id, resolveUser(request)),
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
