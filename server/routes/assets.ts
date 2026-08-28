import { createReadStream } from "node:fs";

import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { Type } from "@sinclair/typebox";

import { AssetSchema, ErrorResponseSchema } from "../../shared/contracts.js";
import type { SessionDraft } from "../../shared/contracts.js";
import { resolveUser } from "../auth.js";
import type { AppDatabase } from "../db.js";
import { assets, sessions } from "../db/schema.js";
import {
  AssetValidationError,
  type createAssetService,
} from "../services/assets.js";

const AssetParamsSchema = Type.Object({
  assetId: Type.String({ minLength: 1 }),
});

type AssetService = ReturnType<typeof createAssetService>;

function notFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: { code: "ASSET_NOT_FOUND", message: "Asset not found." },
  });
}

export function registerAssetRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  assetService: AssetService,
) {
  app.post(
    "/api/assets",
    {
      schema: {
        response: {
          201: AssetSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          413: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const upload = await request.file();
      const sessionField = upload?.fields.sessionId;
      const field = Array.isArray(sessionField)
        ? sessionField[0]
        : sessionField;
      const sessionId = field && "value" in field ? field.value : undefined;
      const ownerId = resolveUser(request);

      if (!upload || typeof sessionId !== "string") {
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Choose an image and its session.",
          },
        });
      }

      const session = database.orm
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.ownerId, ownerId)))
        .get();
      if (!session) {
        return reply.code(404).send({
          error: { code: "SESSION_NOT_FOUND", message: "Session not found." },
        });
      }

      try {
        const asset = await assetService.createReference(
          sessionId,
          ownerId,
          await upload.toBuffer(),
        );
        reply.code(201);
        return asset;
      } catch (error) {
        if (upload.file.truncated) {
          return reply.code(413).send({
            error: {
              code: "ASSET_TOO_LARGE",
              message: "The image exceeds the upload size limit.",
            },
          });
        }
        if (error instanceof AssetValidationError) {
          return reply.code(400).send({
            error: { code: "ASSET_INVALID", message: error.message },
          });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { assetId: string } }>(
    "/api/assets/:assetId",
    {
      schema: {
        params: AssetParamsSchema,
        response: { 404: ErrorResponseSchema },
      },
    },
    (request, reply) => {
      const asset = assetService.findOwnedAsset(
        request.params.assetId,
        resolveUser(request),
      );
      if (!asset) {
        return notFound(reply);
      }

      return reply
        .header("Cache-Control", "private")
        .type(asset.mimeType)
        .send(createReadStream(assetService.assetPath(asset.storagePath)));
    },
  );

  app.delete<{ Params: { assetId: string } }>(
    "/api/assets/:assetId",
    {
      schema: {
        params: AssetParamsSchema,
        response: { 204: Type.Null(), 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const ownerId = resolveUser(request);
      const asset = assetService.findOwnedAsset(
        request.params.assetId,
        ownerId,
      );
      if (!asset) {
        return notFound(reply);
      }

      database.orm
        .delete(assets)
        .where(and(eq(assets.id, asset.id), eq(assets.ownerId, ownerId)))
        .run();

      const session = database.orm
        .select()
        .from(sessions)
        .where(
          and(eq(sessions.id, asset.sessionId), eq(sessions.ownerId, ownerId)),
        )
        .get();
      if (session) {
        const draft = JSON.parse(session.draftJson) as SessionDraft;
        const isSelectedReference = draft.referenceAssetIds.includes(asset.id);
        database.orm
          .update(sessions)
          .set({
            ...(isSelectedReference
              ? {
                  draftJson: JSON.stringify({
                    ...draft,
                    referenceAssetIds: draft.referenceAssetIds.filter(
                      (assetId) => assetId !== asset.id,
                    ),
                  }),
                }
              : {}),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(sessions.id, session.id))
          .run();
      }

      await assetService.removeFile(asset.storagePath);
      return reply.code(204).send(null);
    },
  );
}
