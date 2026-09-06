import { describe, expect, it, vi } from "vitest";

import { parseConfig } from "../server/config.js";
import { createOpenRouterProvider } from "../server/providers/openrouter.js";
import { createModelCatalog } from "../server/services/models.js";

const config = () =>
  parseConfig({
    NODE_ENV: "test",
    OPENROUTER_API_KEY: "test-key",
    AUTH_MODE: "local",
  });

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function catalogModel(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

describe("model catalog", () => {
  it("maps image models with full descriptions and metadata", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            catalogModel(),
            {
              id: "acme/text-only",
              name: "Text only",
              architecture: { output_modalities: ["text"] },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "acme/image-maker",
              created: 1_704_067_200,
              pricing: { prompt: "0.000001", completion: "0.000002" },
              benchmarks: {
                design_arena: [
                  { category: "graphicdesign", rank: 3 },
                  { category: "logo", rank: 8 },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              slug: "acme/image-maker",
              description:
                "Produces image output with the complete description from the frontend catalog.",
              output_modalities: ["image"],
              endpoint: {
                pricing: {
                  display_pricing: [
                    {
                      sku_label: "Image Output",
                      price: "0.03",
                      displayMultiplier: 1,
                      unitLabel: "/image",
                    },
                    {
                      sku_label: "Text Input",
                      price: "0.000005",
                      displayMultiplier: 1_000_000,
                      unitLabel: "/M tokens",
                    },
                  ],
                },
              },
            },
          ],
        }),
      );

    await expect(
      createOpenRouterProvider(config(), fetchImplementation).listImageModels(),
    ).resolves.toEqual([
      {
        providerId: "openrouter",
        modelId: "acme/image-maker",
        name: "Image maker",
        description:
          "Produces image output with the complete description from the frontend catalog.",
        releasedAt: "2024-01-01T00:00:00.000Z",
        displayPricing: [
          { label: "Image Output", price: 0.03, unit: "/image" },
          { label: "Text Input", price: 5, unit: "/M tokens" },
        ],
        benchmarks: {
          designArena: [
            { category: "graphicdesign", rank: 3 },
            { category: "logo", rank: 8 },
          ],
        },
        inputModalities: ["text", "image"],
        capabilities: {
          referenceImages: true,
          resolutions: ["1K", "2K"],
        },
      },
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://openrouter.ai/api/frontend/v1/catalog/models",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          authorization: expect.anything() as unknown,
        }),
      }),
    );
  });

  it("ignores malformed optional metadata", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [catalogModel()] }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            null,
            {
              id: "acme/image-maker",
              created: Number.MAX_VALUE,
              benchmarks: { design_arena: [null, { rank: "first" }] },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            null,
            { slug: "bad", output_modalities: { image: true } },
            {
              slug: "acme/image-maker",
              description: "Detailed.",
              output_modalities: ["image"],
              endpoint: {
                pricing: { display_pricing: [null, { price: "0.01" }] },
              },
            },
          ],
        }),
      );

    await expect(
      createOpenRouterProvider(config(), fetchImplementation).listImageModels(),
    ).resolves.toEqual([
      {
        providerId: "openrouter",
        modelId: "acme/image-maker",
        name: "Image maker",
        description: "Detailed.",
        inputModalities: ["text", "image"],
        capabilities: {
          referenceImages: true,
          resolutions: ["1K", "2K"],
        },
      },
    ]);
  });

  it("bounds optional response body parsing", async () => {
    vi.useFakeTimers();
    try {
      const hangingResponse = {
        ok: true,
        json: () => new Promise<unknown>(() => undefined),
      } as Response;
      const fetchImplementation = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ data: [catalogModel()] }))
        .mockResolvedValue(hangingResponse);
      const models = createOpenRouterProvider(
        config(),
        fetchImplementation,
      ).listImageModels();

      await vi.advanceTimersByTimeAsync(3_000);
      await expect(models).resolves.toMatchObject([
        { modelId: "acme/image-maker" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains the last successful supplemental metadata", async () => {
    let metadataCalls = 0;
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/v1/images/models")) {
        return jsonResponse({ data: [catalogModel()] });
      }
      if (url.includes("/api/v1/models?")) {
        metadataCalls += 1;
        return metadataCalls === 1
          ? jsonResponse({
              data: [
                {
                  id: "acme/image-maker",
                  created: 1_704_067_200,
                  pricing: { prompt: "0.000001" },
                  benchmarks: {
                    design_arena: [{ category: "logo", rank: 4 }],
                  },
                },
              ],
            })
          : jsonResponse({}, 503);
      }
      return jsonResponse({
        data: [
          {
            slug: "acme/image-maker",
            description: "Full description.",
            output_modalities: ["image"],
          },
        ],
      });
    });
    const provider = createOpenRouterProvider(config(), fetchImplementation);

    await provider.listImageModels();
    await expect(provider.listImageModels()).resolves.toMatchObject([
      {
        releasedAt: "2024-01-01T00:00:00.000Z",
        description: "Full description.",
        displayPricing: [{ label: "Text Input", price: 1, unit: "/M tokens" }],
        benchmarks: { designArena: [{ category: "logo", rank: 4 }] },
      },
    ]);
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
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ data: [{ b64_json: "iVBORw0KGgo=" }] }),
      );
    const provider = createOpenRouterProvider(config(), fetchImplementation);

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
