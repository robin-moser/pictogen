import type { ModelCatalog } from "../../shared/contracts.js";
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
