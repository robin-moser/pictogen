import { randomUUID } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import {
  ErrorResponseSchema,
  SessionDetailSchema,
  SessionDraftSchema,
  SessionSummarySchema,
  createEmptyDraft,
} from "../../shared/contracts.js";
import type {
  SessionDetail,
  SessionDraft,
  SessionSummary,
} from "../../shared/contracts.js";
import { resolveUser } from "../auth.js";
import type { AppDatabase } from "../db.js";
import { sessions } from "../db/schema.js";

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

function summaryFromRow(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    knownCostMicrousd: 0,
    costComplete: true,
    activeJobCount: 0,
  };
}

function detailFromRow(row: SessionRow): SessionDetail {
  return {
    ...summaryFromRow(row),
    draft: JSON.parse(row.draftJson) as SessionDraft,
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
        .map(summaryFromRow),
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
      return detailFromRow(row);
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

      return detailFromRow(row);
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
    (request, reply) => {
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

      return detailFromRow(updated);
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
    (request, reply) => {
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

      database.orm
        .delete(sessions)
        .where(and(eq(sessions.id, row.id), eq(sessions.ownerId, ownerId)))
        .run();
      return reply.code(204).send(null);
    },
  );
}
