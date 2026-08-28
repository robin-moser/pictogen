import type { ImageModel } from "../../shared/contracts.js";
import type { AppConfig } from "../config.js";
import type { ImageProvider } from "./types.js";

type OpenRouterModel = {
  id?: string;
  name?: string;
  description?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
};

type OpenRouterCatalog = { data?: OpenRouterModel[] };

function isImageModel(model: OpenRouterModel) {
  return model.architecture?.output_modalities?.includes("image") === true;
}

export function createOpenRouterProvider(
  config: AppConfig,
  fetchImplementation: typeof fetch = fetch,
): ImageProvider {
  return {
    id: "openrouter",
    displayName: "OpenRouter",
    async listImageModels(signal) {
      const response = await fetchImplementation(
        "https://openrouter.ai/api/v1/models",
        {
          headers: {
            authorization: `Bearer ${config.openRouterApiKey}`,
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

      return catalog.data
        .filter(
          (model): model is OpenRouterModel & { id: string; name: string } =>
            Boolean(model.id && model.name && isImageModel(model)),
        )
        .map((model): ImageModel => {
          const capabilities = model.supported_parameters?.includes(
            "input_references",
          )
            ? { referenceImages: true }
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
    },
  };
}
