import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";

import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import {
  assets,
  generationJobs,
  generationRuns,
  jobReferences,
} from "../db/schema.js";
import type { ImageProvider } from "../providers/types.js";
import type { createAssetService } from "./assets.js";

type AssetService = ReturnType<typeof createAssetService>;

function costToMicrousd(cost: number | undefined) {
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? Math.round(cost * 1_000_000)
    : null;
}

export function createGenerationWorker(
  config: AppConfig,
  database: AppDatabase,
  provider: ImageProvider,
  assetService: AssetService,
) {
  const active = new Set<string>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let started = false;

  async function execute(jobId: string) {
    const job = database.orm
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId))
      .get();
    if (!job) return;
    let returnedCost: number | null = null;
    let returnedUsage = "{}";
    try {
      if (!provider.generateImages)
        throw new Error("The configured provider cannot generate images.");
      const run = database.orm
        .select()
        .from(generationRuns)
        .where(eq(generationRuns.id, job.runId))
        .get();
      if (!run) throw new Error("The generation run is unavailable.");
      const options = JSON.parse(run.optionsJson) as {
        resolution: string;
        aspectRatio: string;
      };
      const references = database.orm
        .select({ mimeType: assets.mimeType, storagePath: assets.storagePath })
        .from(jobReferences)
        .innerJoin(assets, eq(jobReferences.assetId, assets.id))
        .where(eq(jobReferences.jobId, job.id))
        .orderBy(jobReferences.ordinal)
        .all();
      const referenceBytes = await Promise.all(
        references.map(async (reference) => ({
          mimeType: reference.mimeType,
          bytes: await readFile(assetService.assetPath(reference.storagePath)),
        })),
      );
      const result = await provider.generateImages({
        modelId: job.modelId,
        prompt: run.prompt,
        count: job.requestedCount,
        resolution: options.resolution,
        aspectRatio: options.aspectRatio,
        references: referenceBytes,
      });
      returnedCost = costToMicrousd(result.usage?.cost);
      returnedUsage = JSON.stringify(result.usage ?? {});
      const image = result.images[0];
      if (!image) {
        database.orm
          .update(generationJobs)
          .set({
            status: "failed",
            usageJson: returnedUsage,
            costMicrousd: returnedCost,
            costComplete: returnedCost !== null,
            errorMessage: "The provider returned no image.",
            finishedAt: new Date().toISOString(),
          })
          .where(eq(generationJobs.id, job.id))
          .run();
        return;
      }
      await assetService.createOutput(
        job.sessionId,
        job.ownerId,
        job.id,
        0,
        image,
      );
      database.orm
        .update(generationJobs)
        .set({
          completedCount: 1,
          status: "succeeded",
          usageJson: returnedUsage,
          costMicrousd: returnedCost,
          costComplete: returnedCost !== null,
          finishedAt: new Date().toISOString(),
        })
        .where(eq(generationJobs.id, job.id))
        .run();
    } catch (error) {
      const current = database.orm
        .select()
        .from(generationJobs)
        .where(eq(generationJobs.id, jobId))
        .get();
      if (current)
        database.orm
          .update(generationJobs)
          .set({
            status: current.completedCount ? "partial" : "failed",
            costMicrousd: returnedCost,
            costComplete: returnedCost !== null,
            usageJson: returnedUsage,
            errorMessage:
              error instanceof Error ? error.message : "Generation failed.",
            finishedAt: new Date().toISOString(),
          })
          .where(eq(generationJobs.id, jobId))
          .run();
    } finally {
      active.delete(jobId);
      void pump();
    }
  }

  async function pump() {
    while (active.size < config.globalConcurrency) {
      const candidates = database.orm
        .select()
        .from(generationJobs)
        .where(eq(generationJobs.status, "queued"))
        .orderBy(generationJobs.queueOrder)
        .all();
      const candidate = candidates.find(
        (job) =>
          database.orm
            .select()
            .from(generationJobs)
            .where(
              and(
                eq(generationJobs.ownerId, job.ownerId),
                eq(generationJobs.status, "running"),
              ),
            )
            .all().length < config.perUserConcurrency,
      );
      if (!candidate) return;
      const claimed = database.orm
        .update(generationJobs)
        .set({ status: "running", startedAt: new Date().toISOString() })
        .where(
          and(
            eq(generationJobs.id, candidate.id),
            eq(generationJobs.status, "queued"),
          ),
        )
        .run();
      if (!claimed.changes) continue;
      active.add(candidate.id);
      void execute(candidate.id);
    }
  }

  return {
    wake: () => {
      if (started) void pump();
    },
    start() {
      started = true;
      database.orm
        .update(generationJobs)
        .set({
          status: "failed",
          costComplete: false,
          errorMessage: "Generation was interrupted by a server restart.",
          finishedAt: new Date().toISOString(),
        })
        .where(eq(generationJobs.status, "running"))
        .run();
      timer = setInterval(() => void pump(), 1_000);
      void pump();
    },
    stop() {
      started = false;
      if (timer) clearInterval(timer);
    },
  };
}
