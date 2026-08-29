import { describe, expect, it, vi } from "vitest";

import { parseConfig } from "../server/config.js";
import { createOpenRouterProvider } from "../server/providers/openrouter.js";
import { createModelCatalog } from "../server/services/models.js";

describe("model catalog", () => {
  it("maps OpenRouter image output models without exposing provider data", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "acme/image-maker",
              name: "Image maker",
              description: "Produces image output.",
              architecture: {
                input_modalities: ["text", "image"],
                output_modalities: ["image"],
              },
              supported_parameters: {
                input_references: { type: "boolean" },
                resolution: { type: "enum", values: ["1K", "2K"] },
              },
            },
            {
              id: "acme/text-only",
              name: "Text only",
              architecture: { output_modalities: ["text"] },
            },
          ],
        }),
      ),
    );
    const provider = createOpenRouterProvider(
      parseConfig({
        NODE_ENV: "test",
        OPENROUTER_API_KEY: "test-key",
        AUTH_MODE: "local",
      }),
      fetchImplementation,
    );

    await expect(provider.listImageModels()).resolves.toEqual([
      {
        providerId: "openrouter",
        modelId: "acme/image-maker",
        name: "Image maker",
        description: "Produces image output.",
        inputModalities: ["text", "image"],
        capabilities: {
          referenceImages: true,
          resolutions: ["1K", "2K"],
        },
      },
    ]);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/images/models",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer test-key" }),
      }),
    );
  });

  it("uses a stale catalog when a refresh fails", async () => {
    const provider = {
      id: "test",
      displayName: "Test",
      listImageModels: vi
        .fn()
        .mockResolvedValueOnce([
          {
            providerId: "test",
            modelId: "image",
            name: "Image",
            inputModalities: ["text"] as const,
          },
        ])
        .mockRejectedValueOnce(new Error("Unavailable")),
    };
    const catalog = createModelCatalog(provider, 0);

    await expect(catalog.load()).resolves.toMatchObject({ stale: false });
    await expect(catalog.load()).resolves.toMatchObject({
      stale: true,
      error: "Unavailable",
    });
  });

  it("sends only effective OpenRouter options", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ b64_json: "iVBORw0KGgo=" }],
        }),
      ),
    );
    const provider = createOpenRouterProvider(
      parseConfig({
        NODE_ENV: "test",
        OPENROUTER_API_KEY: "test-key",
        AUTH_MODE: "local",
      }),
      fetchImplementation,
    );

    await provider.generateImages?.({
      modelId: "acme/image-maker",
      prompt: "Test",
      count: 1,
      quality: "high",
      background: "transparent",
      outputFormat: "webp",
      outputCompression: 80,
      references: [],
    });

    expect(
      JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)),
    ).toEqual({
      model: "acme/image-maker",
      prompt: "Test",
      n: 1,
      quality: "high",
      background: "transparent",
      output_format: "webp",
      output_compression: 80,
    });
  });
});
