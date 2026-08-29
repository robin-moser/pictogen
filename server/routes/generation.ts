import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { and, eq, inArray, isNull, max } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  CreateRunSchema,
  ErrorResponseSchema,
  GenerationRunSchema,
} from "../../shared/contracts.js";
import type { CreateRun } from "../../shared/contracts.js";
import {
  getReferenceLimitErrors,
  resolveEffectiveOptions,
} from "../../shared/capabilities.js";
import type { ImageModel } from "../../shared/contracts.js";
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

const SessionParams = Type.Object({ sessionId: Type.String({ minLength: 1 }) });
const JobParams = Type.Object({ jobId: Type.String({ minLength: 1 }) });
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
        params: SessionParams,
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
      const models = selectedModels as ImageModel[];
      const referenceLimitErrors = getReferenceLimitErrors(
        {
          models: request.body.models,
          referenceAssetIds: request.body.referenceAssetIds,
        },
        models,
      );
      if (referenceLimitErrors.length)
        return reply.code(400).send({
          error: {
            code: "MODEL_OPTION_UNSUPPORTED",
            message: referenceLimitErrors[0] ?? "Reference limit exceeded.",
          },
        });
      const effectiveOptions = models.map(
        (model) => resolveEffectiveOptions(model, request.body.options).options,
      );
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
        request.body.models.forEach((model, modelIndex) => {
          const modelName = models[modelIndex]?.name;
          if (!modelName) throw new Error("The selected model is unavailable.");
          for (
            let imageIndex = 0;
            imageIndex < request.body.count;
            imageIndex += 1
          ) {
            const jobId = randomUUID();
            tx.insert(generationJobs)
              .values({
                id: jobId,
                runId,
                sessionId: session.id,
                ownerId,
                queueOrder:
                  queueOrder + modelIndex * request.body.count + imageIndex,
                providerId: model.providerId,
                modelId: model.modelId,
                modelName,
                effectiveOptionsJson: JSON.stringify(
                  effectiveOptions[modelIndex],
                ),
                requestedCount: 1,
                completedCount: 0,
                status: "queued",
                usageJson: "[]",
                costMicrousd: 0,
                costComplete: true,
                createdAt: now,
              })
              .run();
            request.body.referenceAssetIds.forEach((assetId, ordinal) =>
              tx
                .insert(jobReferences)
                .values({ jobId, assetId, ordinal })
                .run(),
            );
          }
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

  app.post<{ Params: { jobId: string } }>(
    "/api/jobs/:jobId/cancel",
    {
      schema: {
        params: JobParams,
        response: {
          204: Type.Null(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    (request, reply) => {
      const ownerId = resolveUser(request);
      const job = database.orm
        .select({ status: generationJobs.status })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.id, request.params.jobId),
            eq(generationJobs.ownerId, ownerId),
          ),
        )
        .get();

      if (!job) {
        return reply.code(404).send({
          error: { code: "JOB_NOT_FOUND", message: "Job not found." },
        });
      }

      if (job.status !== "queued") {
        return reply.code(409).send({
          error: {
            code: "JOB_NOT_CANCELLABLE",
            message: "Only queued jobs can be cancelled.",
          },
        });
      }

      const cancelled = database.orm
        .update(generationJobs)
        .set({ status: "cancelled", finishedAt: new Date().toISOString() })
        .where(
          and(
            eq(generationJobs.id, request.params.jobId),
            eq(generationJobs.ownerId, ownerId),
            eq(generationJobs.status, "queued"),
          ),
        )
        .run();

      if (!cancelled.changes) {
        return reply.code(409).send({
          error: {
            code: "JOB_NOT_CANCELLABLE",
            message: "Only queued jobs can be cancelled.",
          },
        });
      }

      return reply.code(204).send(null);
    },
  );

  app.delete<{ Params: { jobId: string } }>(
    "/api/jobs/:jobId",
    {
      schema: {
        params: JobParams,
        response: {
          204: Type.Null(),
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    (request, reply) => {
      const ownerId = resolveUser(request);
      const job = database.orm
        .select({
          id: generationJobs.id,
          sessionId: generationJobs.sessionId,
          status: generationJobs.status,
        })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.id, request.params.jobId),
            eq(generationJobs.ownerId, ownerId),
            isNull(generationJobs.hiddenAt),
          ),
        )
        .get();

      if (!job) {
        return reply.code(404).send({
          error: { code: "JOB_NOT_FOUND", message: "Job not found." },
        });
      }

      if (job.status !== "failed") {
        return reply.code(409).send({
          error: {
            code: "JOB_NOT_DISMISSIBLE",
            message: "Only failed jobs can be removed from the generation log.",
          },
        });
      }

      const hiddenAt = new Date().toISOString();
      database.orm
        .update(generationJobs)
        .set({ hiddenAt })
        .where(
          and(
            eq(generationJobs.id, job.id),
            eq(generationJobs.ownerId, ownerId),
            isNull(generationJobs.hiddenAt),
          ),
        )
        .run();
      database.orm
        .update(sessions)
        .set({ updatedAt: hiddenAt })
        .where(
          and(eq(sessions.id, job.sessionId), eq(sessions.ownerId, ownerId)),
        )
        .run();

      return reply.code(204).send(null);
    },
  );

  app.delete<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/generation-log",
    {
      schema: {
        params: SessionParams,
        response: {
          204: Type.Null(),
          404: ErrorResponseSchema,
        },
      },
    },
    (request, reply) => {
      const ownerId = resolveUser(request);
      const session = database.orm
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.id, request.params.sessionId),
            eq(sessions.ownerId, ownerId),
          ),
        )
        .get();

      if (!session) {
        return reply.code(404).send({
          error: { code: "SESSION_NOT_FOUND", message: "Session not found." },
        });
      }

      const hiddenAt = new Date().toISOString();
      const hidden = database.orm
        .update(generationJobs)
        .set({ hiddenAt })
        .where(
          and(
            eq(generationJobs.sessionId, session.id),
            eq(generationJobs.ownerId, ownerId),
            inArray(generationJobs.status, ["failed"]),
            isNull(generationJobs.hiddenAt),
          ),
        )
        .run();

      if (hidden.changes) {
        database.orm
          .update(sessions)
          .set({ updatedAt: hiddenAt })
          .where(
            and(eq(sessions.id, session.id), eq(sessions.ownerId, ownerId)),
          )
          .run();
      }

      return reply.code(204).send(null);
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
    .where(
      and(eq(generationJobs.runId, runId), isNull(generationJobs.hiddenAt)),
    )
    .orderBy(generationJobs.queueOrder)
    .all()
    .map((job) => ({
      id: job.id,
      runId: job.runId,
      providerId: job.providerId,
      modelId: job.modelId,
      modelName: job.modelName,
      effectiveOptions: JSON.parse(job.effectiveOptionsJson),
      requestedCount: job.requestedCount,
      completedCount: job.completedCount,
      status: job.status,
      costMicrousd: job.costMicrousd,
      costComplete: job.costComplete,
      ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
      createdAt: job.createdAt,
      referenceAssetIds: database.orm
        .select({ assetId: jobReferences.assetId })
        .from(jobReferences)
        .where(eq(jobReferences.jobId, job.id))
        .orderBy(jobReferences.ordinal)
        .all()
        .map((reference) => reference.assetId),
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
          width: asset.width,
          height: asset.height,
          blurHash: asset.blurHash,
          starred: asset.starred,
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
