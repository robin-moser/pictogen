import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { and, eq, inArray, max } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  CreateRunSchema,
  ErrorResponseSchema,
  GenerationRunSchema,
} from "../../shared/contracts.js";
import type { CreateRun } from "../../shared/contracts.js";
import { resolveUser } from "../auth.js";
import type { AppDatabase } from "../db.js";
import {
  assets,
  generationJobs,
  generationRuns,
  jobReferences,
  sessions,
} from "../db/schema.js";
import type { ImageProvider } from "../providers/types.js";

const Params = Type.Object({ sessionId: Type.String({ minLength: 1 }) });
export function registerGenerationRoutes(
  app: FastifyInstance,
  database: AppDatabase,
  provider: ImageProvider,
  wake: () => void,
) {
  app.post<{ Params: { sessionId: string }; Body: CreateRun }>(
    "/api/sessions/:sessionId/runs",
    {
      schema: {
        params: Params,
        body: CreateRunSchema,
        response: {
          202: Type.Object({ run: GenerationRunSchema }),
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ownerId = resolveUser(request);
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || !key.trim())
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "An Idempotency-Key header is required.",
          },
        });
      const existing = database.orm
        .select()
        .from(generationRuns)
        .where(
          and(
            eq(generationRuns.ownerId, ownerId),
            eq(generationRuns.idempotencyKey, key),
          ),
        )
        .get();
      if (existing)
        return reply
          .code(202)
          .send({ run: requiredRunDetail(database, existing.id) });
      const session = database.orm
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.id, request.params.sessionId),
            eq(sessions.ownerId, ownerId),
          ),
        )
        .get();
      if (!session)
        return reply.code(404).send({
          error: { code: "SESSION_NOT_FOUND", message: "Session not found." },
        });
      const available = await provider.listImageModels();
      const selectedModels = request.body.models.map((selection) =>
        available.find(
          (model) =>
            model.providerId === selection.providerId &&
            model.modelId === selection.modelId,
        ),
      );
      if (selectedModels.some((model) => !model))
        return reply.code(400).send({
          error: {
            code: "MODEL_UNAVAILABLE",
            message: "One or more selected models are unavailable.",
          },
        });
      const incompatible = selectedModels.find(
        (model) =>
          model &&
          ((model.capabilities?.resolutions &&
            !model.capabilities.resolutions.includes(
              request.body.options.resolution,
            )) ||
            (model.capabilities?.aspectRatios &&
              !model.capabilities.aspectRatios.includes(
                request.body.options.aspectRatio,
              )) ||
            (request.body.referenceAssetIds.length > 0 &&
              model.capabilities?.referenceImages === false)),
      );
      if (incompatible)
        return reply.code(400).send({
          error: {
            code: "MODEL_OPTION_UNSUPPORTED",
            message: `${incompatible.name} does not support the selected generation settings.`,
          },
        });
      const references = request.body.referenceAssetIds.length
        ? database.orm
            .select({ id: assets.id })
            .from(assets)
            .where(
              and(
                eq(assets.ownerId, ownerId),
                eq(assets.sessionId, session.id),
                inArray(assets.id, request.body.referenceAssetIds),
              ),
            )
            .all()
        : [];
      if (references.length !== request.body.referenceAssetIds.length)
        return reply.code(400).send({
          error: {
            code: "ASSET_INVALID",
            message: "One or more reference images are unavailable.",
          },
        });
      const now = new Date().toISOString();
      const runId = randomUUID();
      const queueOrder =
        (database.orm
          .select({ value: max(generationJobs.queueOrder) })
          .from(generationJobs)
          .get()?.value ?? 0) + 1;
      database.orm.transaction((tx) => {
        tx.insert(generationRuns)
          .values({
            id: runId,
            sessionId: session.id,
            ownerId,
            idempotencyKey: key,
            prompt: request.body.prompt,
            optionsJson: JSON.stringify(request.body.options),
            requestedCount: request.body.count,
            createdAt: now,
          })
          .run();
        request.body.models.forEach((model, index) => {
          const jobId = randomUUID();
          const modelName = selectedModels[index]?.name;
          if (!modelName) throw new Error("The selected model is unavailable.");
          tx.insert(generationJobs)
            .values({
              id: jobId,
              runId,
              sessionId: session.id,
              ownerId,
              queueOrder: queueOrder + index,
              providerId: model.providerId,
              modelId: model.modelId,
              modelName,
              requestedCount: request.body.count,
              completedCount: 0,
              status: "queued",
              usageJson: "[]",
              costMicrousd: 0,
              costComplete: true,
              createdAt: now,
            })
            .run();
          request.body.referenceAssetIds.forEach((assetId, ordinal) =>
            tx.insert(jobReferences).values({ jobId, assetId, ordinal }).run(),
          );
        });
        tx.update(sessions)
          .set({ updatedAt: now })
          .where(eq(sessions.id, session.id))
          .run();
      });
      wake();
      reply.code(202);
      return { run: requiredRunDetail(database, runId) };
    },
  );
}
export function runDetail(database: AppDatabase, runId: string) {
  const run = database.orm
    .select()
    .from(generationRuns)
    .where(eq(generationRuns.id, runId))
    .get();
  if (!run) return undefined;
  const jobs = database.orm
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.runId, runId))
    .all()
    .map((job) => ({
      id: job.id,
      runId: job.runId,
      providerId: job.providerId,
      modelId: job.modelId,
      modelName: job.modelName,
      requestedCount: job.requestedCount,
      completedCount: job.completedCount,
      status: job.status,
      costMicrousd: job.costMicrousd,
      costComplete: job.costComplete,
      ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
      createdAt: job.createdAt,
      outputs: database.orm
        .select()
        .from(assets)
        .where(eq(assets.jobId, job.id))
        .orderBy(assets.ordinal)
        .all()
        .map((asset) => ({
          id: asset.id,
          sessionId: asset.sessionId,
          kind: asset.kind,
          mimeType: asset.mimeType,
          bytes: asset.bytes,
          createdAt: asset.createdAt,
        })),
    }));
  return {
    id: run.id,
    prompt: run.prompt,
    options: JSON.parse(run.optionsJson),
    requestedCount: run.requestedCount,
    createdAt: run.createdAt,
    jobs,
  };
}

function requiredRunDetail(database: AppDatabase, runId: string) {
  const run = runDetail(database, runId);
  if (!run) throw new Error("The created generation run could not be read.");
  return run;
}
