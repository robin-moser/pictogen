import type { ImageModel } from "../../shared/contracts.js";
import type { AppConfig } from "../config.js";
import type { ImageProvider } from "./types.js";

type OpenRouterModel = {
  id?: string;
  name?: string;
  description?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: Record<
    string,
    { type?: string; values?: string[]; min?: number; max?: number }
  >;
};

type OpenRouterCatalog = { data?: OpenRouterModel[] };

type Resolution = "512" | "1K" | "2K" | "4K";
type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3";
type Quality = "auto" | "low" | "medium" | "high";
type Background = "auto" | "transparent" | "opaque";
type OutputFormat = "png" | "jpeg" | "webp";

function isImageModel(model: OpenRouterModel) {
  return model.architecture?.output_modalities?.includes("image") === true;
}

export function createOpenRouterProvider(
  config: AppConfig,
  fetchImplementation: typeof fetch = fetch,
): ImageProvider {
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY must be set outside demo mode.");
  }

  const apiKey = config.openRouterApiKey;

  return {
    id: "openrouter",
    displayName: "OpenRouter",
    async listImageModels(signal) {
      const response = await fetchImplementation(
        "https://openrouter.ai/api/v1/images/models",
        {
          headers: {
            authorization: `Bearer ${apiKey}`,
            "http-referer": config.publicUrl.origin,
            "x-title": "Pictogen",
          },
          signal: signal ?? null,
        },
      );

      if (!response.ok) {
        throw new Error("The model catalog could not be refreshed.");
      }

      const catalog = (await response.json()) as OpenRouterCatalog;
      if (!Array.isArray(catalog.data)) {
        throw new Error("The model catalog returned an unexpected response.");
      }

      const imageModels = catalog.data
        .filter(
          (model): model is OpenRouterModel & { id: string; name: string } =>
            Boolean(model.id && model.name && isImageModel(model)),
        )
        .map((model): ImageModel => {
          const parameters = model.supported_parameters;
          const resolutions = parameters?.resolution?.values?.filter((value) =>
            ["512", "1K", "2K", "4K"].includes(value),
          ) as Resolution[] | undefined;
          const aspectRatios = parameters?.aspect_ratio?.values?.filter(
            (value) =>
              ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"].includes(
                value,
              ),
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
            ...(model.description ? { description: model.description } : {}),
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
