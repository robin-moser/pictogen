import type { ImageModel, ModelCatalog } from "../../shared/contracts.js";
import type { AppDatabase } from "../db.js";
import { generationJobs } from "../db/schema.js";
import type { ImageProvider } from "../providers/types.js";

export function createModelCatalog(
  provider: ImageProvider,
  ttlSeconds: number,
) {
  let cached: ModelCatalog | null = null;
  let refresh: Promise<ModelCatalog> | null = null;

  async function load(): Promise<ModelCatalog> {
    const now = new Date();
    const staleCatalog = cached;
    const fresh =
      staleCatalog &&
      now.getTime() - new Date(staleCatalog.fetchedAt).getTime() <
        ttlSeconds * 1000;

    if (fresh) {
      return staleCatalog;
    }

    if (refresh) {
      return refresh;
    }

    refresh = provider
      .listImageModels()
      .then((models) => ({
        models,
        fetchedAt: now.toISOString(),
        stale: false,
      }))
      .catch((error: unknown) => {
        if (staleCatalog) {
          return {
            ...staleCatalog,
            stale: true,
            error:
              error instanceof Error
                ? error.message
                : "The model catalog could not be refreshed.",
          };
        }

        throw error;
      })
      .finally(() => {
        refresh = null;
      });

    const result = await refresh;
    if (!result.stale) {
      cached = result;
    }
    return result;
  }

  return { load };
}

export function createDemoModelCatalog(database: AppDatabase) {
  async function load(): Promise<ModelCatalog> {
    const models = new Map<string, ImageModel>();

    for (const job of database.orm
      .select({
        providerId: generationJobs.providerId,
        modelId: generationJobs.modelId,
        modelName: generationJobs.modelName,
      })
      .from(generationJobs)
      .all()) {
      const key = `${job.providerId}:${job.modelId}`;
      if (!models.has(key)) {
        models.set(key, {
          providerId: job.providerId,
          modelId: job.modelId,
          name: job.modelName,
          inputModalities: ["text", "image"],
        });
      }
    }

    return {
      models: [...models.values()],
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
  }

  return { load };
}
