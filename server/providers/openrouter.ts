import type { ImageModel } from "../../shared/contracts.js";
import type { AppConfig } from "../config.js";
import type { ImageProvider } from "./types.js";

// Undocumented endpoint backing openrouter.ai's own model pages. It carries two
// things the public API omits: untruncated descriptions and effective per-image
// prices. Treated as best-effort enrichment only — never required for a model to
// be listed or generated with.
const FRONTEND_CATALOG_URL =
  "https://openrouter.ai/api/frontend/v1/catalog/models";
const ENRICHMENT_TIMEOUT_MS = 3_000;
const DETAILS_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

type OpenRouterModel = {
  id?: string;
  name?: string;
  description?: string;
  created?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  benchmarks?: {
    design_arena?: Array<{ category?: string; rank?: number }>;
  };
  supported_parameters?: Record<
    string,
    { type?: string; values?: string[]; min?: number; max?: number }
  >;
};

type ModelDetails = {
  description?: string;
  displayPricing?: ImageModel["displayPricing"];
};

type Resolution = "512" | "1K" | "2K" | "4K";
type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3";
type Quality = "auto" | "low" | "medium" | "high";
type Background = "auto" | "transparent" | "opaque";
type OutputFormat = "png" | "jpeg" | "webp";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function isImageModel(model: OpenRouterModel) {
  const outputModalities = model.architecture?.output_modalities;
  return Array.isArray(outputModalities) && outputModalities.includes("image");
}

function hasModelId(model: unknown): model is OpenRouterModel & { id: string } {
  return (
    typeof model === "object" &&
    model !== null &&
    typeof (model as OpenRouterModel).id === "string" &&
    Boolean((model as OpenRouterModel).id)
  );
}

function price(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

// `price` is a base rate that `displayMultiplier` scales into the advertised
// unit. Units vary across models, so they remain explicit.
function displayPricing(entries: unknown) {
  if (!Array.isArray(entries)) {
    return undefined;
  }
  const parsed: NonNullable<ImageModel["displayPricing"]> = [];
  for (const value of entries) {
    const entry = record(value);
    if (!entry) {
      continue;
    }
    const label = entry.sku_label;
    const unit = entry.unitLabel;
    const rawPrice = entry.price;
    const multiplier = entry.displayMultiplier ?? 1;
    if (
      typeof label !== "string" ||
      !label ||
      typeof unit !== "string" ||
      !unit ||
      typeof rawPrice !== "string" ||
      typeof multiplier !== "number" ||
      !Number.isFinite(multiplier) ||
      multiplier <= 0
    ) {
      continue;
    }
    const base = Number(rawPrice);
    if (!Number.isFinite(base) || base < 0) {
      continue;
    }
    parsed.push({ label, price: base * multiplier, unit });
  }
  return parsed.length ? parsed : undefined;
}

function modelDetails(catalog: unknown) {
  const details = new Map<string, ModelDetails>();
  const data = record(catalog)?.data;
  if (!Array.isArray(data)) {
    return details;
  }
  for (const value of data) {
    const model = record(value);
    const outputModalities = model?.output_modalities;
    if (
      !model ||
      typeof model.slug !== "string" ||
      !model.slug ||
      !Array.isArray(outputModalities) ||
      !outputModalities.includes("image")
    ) {
      continue;
    }
    const description =
      typeof model.description === "string" && model.description
        ? model.description
        : undefined;
    const endpoint = record(model.endpoint);
    const pricing = record(endpoint?.pricing);
    const parsedPricing = displayPricing(pricing?.display_pricing);
    if (description || parsedPricing) {
      details.set(model.slug, {
        ...(description ? { description } : {}),
        ...(parsedPricing ? { displayPricing: parsedPricing } : {}),
      });
    }
  }
  return details;
}

function tokenPricing(pricing: OpenRouterModel["pricing"]) {
  const input = price(pricing?.prompt);
  const output = price(pricing?.completion);
  const entries: NonNullable<ImageModel["displayPricing"]> = [];
  if (input !== undefined) {
    entries.push({
      label: "Text Input",
      price: input * 1_000_000,
      unit: "/M tokens",
    });
  }
  if (output !== undefined) {
    entries.push({
      label: "Text Output",
      price: output * 1_000_000,
      unit: "/M tokens",
    });
  }
  return entries.length ? entries : undefined;
}

function releasedAt(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function createOpenRouterProvider(
  config: AppConfig,
  fetchImplementation: typeof fetch = fetch,
): ImageProvider {
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY must be set outside demo mode.");
  }

  const apiKey = config.openRouterApiKey;

  let detailsCache: {
    fetchedAt: number;
    details: Map<string, ModelDetails>;
  } | null = null;
  let metadataCache = new Map<string, OpenRouterModel & { id: string }>();

  async function loadOptionalJson(
    input: string,
    init: RequestInit,
    signal?: AbortSignal,
  ) {
    const controller = new AbortController();
    const stop = () => controller.abort(signal?.reason);
    if (signal?.aborted) {
      stop();
    } else {
      signal?.addEventListener("abort", stop, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), ENRICHMENT_TIMEOUT_MS);
    timer.unref();
    const aborted = new Promise<null>((resolve) => {
      if (controller.signal.aborted) {
        resolve(null);
      } else {
        controller.signal.addEventListener("abort", () => resolve(null), {
          once: true,
        });
      }
    });

    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImplementation(input, {
            ...init,
            signal: controller.signal,
          });
          return response.ok ? response.json() : undefined;
        })().catch(() => undefined),
        aborted,
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }

  // This unfilterable payload covers every OpenRouter model, so refresh it less
  // often than the main catalog and retain the last successful result.
  async function loadModelDetails(signal?: AbortSignal) {
    const cached = detailsCache;
    if (cached && Date.now() - cached.fetchedAt < DETAILS_CACHE_TTL_MS) {
      return cached.details;
    }

    // Deliberately unauthenticated: this endpoint is public and CDN-cached, so
    // the API key has no reason to travel to an unsupported surface.
    const catalog = await loadOptionalJson(
      FRONTEND_CATALOG_URL,
      {
        headers: {
          "http-referer": config.publicUrl.origin,
          "x-title": "Pictogen",
        },
      },
      signal,
    );
    const details = modelDetails(catalog);
    if (!details.size) {
      return cached?.details;
    }
    detailsCache = { fetchedAt: Date.now(), details };
    return details;
  }

  return {
    id: "openrouter",
    displayName: "OpenRouter",
    async listImageModels(signal) {
      const headers = {
        authorization: `Bearer ${apiKey}`,
        "http-referer": config.publicUrl.origin,
        "x-title": "Pictogen",
      };
      const catalogRequest = fetchImplementation(
        "https://openrouter.ai/api/v1/images/models",
        {
          headers,
          signal: signal ?? null,
        },
      );
      const metadataRequest = loadOptionalJson(
        "https://openrouter.ai/api/v1/models?output_modalities=image",
        { headers },
        signal,
      );
      const response = await catalogRequest;

      if (!response.ok) {
        throw new Error("The model catalog could not be refreshed.");
      }

      const catalog = record(await response.json());
      if (!Array.isArray(catalog?.data)) {
        throw new Error("The model catalog returned an unexpected response.");
      }
      const listed = catalog.data.filter(
        (model): model is OpenRouterModel & { id: string; name: string } =>
          hasModelId(model) &&
          typeof model.name === "string" &&
          Boolean(model.name) &&
          isImageModel(model),
      );
      const [metadataCatalogValue, detailsById] = await Promise.all([
        metadataRequest,
        loadModelDetails(signal),
      ]);
      const metadataCatalog = record(metadataCatalogValue);
      if (Array.isArray(metadataCatalog?.data)) {
        const metadata = new Map(
          metadataCatalog.data
            .filter(hasModelId)
            .map((model) => [model.id, model]),
        );
        if (metadata.size) metadataCache = metadata;
      }

      const imageModels = listed.map((model): ImageModel => {
        const metadata = metadataCache.get(model.id);
        const details = detailsById?.get(model.id);
        const created = metadata?.created ?? model.created;
        const releaseDate = releasedAt(created);
        const parameters = model.supported_parameters;
        const resolutions = parameters?.resolution?.values?.filter((value) =>
          ["512", "1K", "2K", "4K"].includes(value),
        ) as Resolution[] | undefined;
        const aspectRatios = parameters?.aspect_ratio?.values?.filter((value) =>
          ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"].includes(value),
        ) as AspectRatio[] | undefined;
        const qualities = parameters?.quality?.values?.filter((value) =>
          ["auto", "low", "medium", "high"].includes(value),
        ) as Quality[] | undefined;
        const backgrounds = parameters?.background?.values?.filter((value) =>
          ["auto", "transparent", "opaque"].includes(value),
        ) as Background[] | undefined;
        const outputFormats = parameters?.output_format?.values?.filter(
          (value) => ["png", "jpeg", "webp"].includes(value),
        ) as OutputFormat[] | undefined;
        const compression = parameters?.output_compression;
        const description = details?.description ?? model.description;
        const effectivePricing =
          details?.displayPricing ?? tokenPricing(metadata?.pricing);
        const rawDesignArena = metadata?.benchmarks?.design_arena;
        const designArena = Array.isArray(rawDesignArena)
          ? rawDesignArena
              .filter(
                (benchmark): benchmark is { category: string; rank: number } =>
                  typeof benchmark === "object" &&
                  benchmark !== null &&
                  typeof benchmark.category === "string" &&
                  benchmark.category.length > 0 &&
                  typeof benchmark.rank === "number" &&
                  Number.isInteger(benchmark.rank) &&
                  benchmark.rank > 0,
              )
              .map(({ category, rank }) => ({ category, rank }))
          : undefined;
        const capabilities = parameters
          ? {
              referenceImages: Boolean(parameters.input_references),
              ...(parameters.input_references?.max !== undefined
                ? { maxReferenceImages: parameters.input_references.max }
                : {}),
              ...(resolutions ? { resolutions } : {}),
              ...(aspectRatios ? { aspectRatios } : {}),
              ...(qualities ? { qualities } : {}),
              ...(backgrounds ? { backgrounds } : {}),
              ...(outputFormats ? { outputFormats } : {}),
              ...(typeof compression?.min === "number" &&
              typeof compression.max === "number"
                ? {
                    outputCompression: {
                      minimum: compression.min,
                      maximum: compression.max,
                    },
                  }
                : {}),
              ...(parameters.n?.max
                ? { maxImagesPerRequest: parameters.n.max }
                : {}),
            }
          : undefined;
        return {
          providerId: "openrouter",
          modelId: model.id,
          name: model.name,
          inputModalities: model.architecture?.input_modalities?.includes(
            "image",
          )
            ? ["text", "image"]
            : ["text"],
          ...(description ? { description } : {}),
          ...(releaseDate ? { releasedAt: releaseDate } : {}),
          ...(effectivePricing ? { displayPricing: effectivePricing } : {}),
          ...(designArena?.length ? { benchmarks: { designArena } } : {}),
          ...(capabilities ? { capabilities } : {}),
        };
      });
      return imageModels;
    },
    async generateImages(request, signal) {
      const response = await fetchImplementation(
        "https://openrouter.ai/api/v1/images",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.openRouterApiKey}`,
            "content-type": "application/json",
            "http-referer": config.publicUrl.origin,
            "x-title": "Pictogen",
          },
          body: JSON.stringify({
            model: request.modelId,
            prompt: request.prompt,
            n: request.count,
            ...(request.resolution ? { resolution: request.resolution } : {}),
            ...(request.aspectRatio
              ? { aspect_ratio: request.aspectRatio }
              : {}),
            ...(request.quality ? { quality: request.quality } : {}),
            ...(request.background ? { background: request.background } : {}),
            ...(request.outputFormat
              ? { output_format: request.outputFormat }
              : {}),
            ...(request.outputCompression !== undefined
              ? { output_compression: request.outputCompression }
              : {}),
            ...(request.references.length
              ? {
                  input_references: request.references.map(
                    (reference) =>
                      ({
                        type: "image_url",
                        image_url: {
                          url: `data:${reference.mimeType};base64,${reference.bytes.toString("base64")}`,
                        },
                      }) as const,
                  ),
                }
              : {}),
          }),
          signal: signal ?? null,
        },
      );
      if (!response.ok) {
        const error = (await response.json().catch(() => undefined)) as
          | {
              error?: {
                message?: unknown;
                metadata?: { error_type?: unknown };
              };
            }
          | undefined;
        const message = error?.error?.message;
        const errorType = error?.error?.metadata?.error_type;
        const retryAfter = response.headers.get("retry-after");
        const detail =
          typeof message === "string"
            ? message.slice(0, 500)
            : "The image provider rejected the request.";
        const category = typeof errorType === "string" ? ` (${errorType})` : "";
        const retry =
          retryAfter && /^\d+$/.test(retryAfter)
            ? ` Try again in ${retryAfter} seconds.`
            : "";
        throw new Error(
          `OpenRouter ${response.status}${category}: ${detail}${retry}`,
        );
      }
      const body = (await response.json()) as {
        data?: Array<{ b64_json?: string }>;
        usage?: { cost?: number; [key: string]: unknown };
      };
      if (
        !Array.isArray(body.data) ||
        !body.data.every(
          (image): image is { b64_json: string } =>
            typeof image.b64_json === "string",
        )
      )
        throw new Error(
          "The image provider returned an unsupported image response.",
        );
      return {
        images: body.data.map((image) => Buffer.from(image.b64_json, "base64")),
        ...(body.usage ? { usage: body.usage } : {}),
      };
    },
  };
}
