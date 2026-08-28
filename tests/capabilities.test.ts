import { describe, expect, it } from "vitest";

import {
  getReferenceLimitErrors,
  resolveEffectiveOptions,
} from "../shared/capabilities.js";
import { createEmptyDraft } from "../shared/contracts.js";

describe("generation capability resolution", () => {
  it("maps known geometry, omits unknown geometry, and preserves effective output settings", () => {
    const requested = {
      resolution: "4K" as const,
      aspectRatio: "3:2" as const,
      quality: "high" as const,
      background: "transparent" as const,
      outputFormat: "webp" as const,
      outputCompression: 95,
    };

    expect(
      resolveEffectiveOptions(
        {
          providerId: "openrouter",
          modelId: "qwen/qwen-image-3",
          name: "Qwen Image 3",
          inputModalities: ["text"],
          capabilities: {
            resolutions: ["1K", "2K"],
            aspectRatios: ["1:1", "3:2"],
            qualities: ["low", "medium"],
            outputCompression: { minimum: 0, maximum: 80 },
          },
        },
        requested,
      ),
    ).toEqual({
      options: { resolution: "2K", aspectRatio: "3:2", outputCompression: 80 },
      changes: [
        "resolution 4K -> 2K",
        "quality high not sent",
        "background transparent not sent",
        "output format webp not sent",
        "output compression 95 -> 80",
      ],
    });

    expect(
      resolveEffectiveOptions(
        {
          providerId: "openrouter",
          modelId: "openai/gpt-5-image",
          name: "GPT-5 Image",
          inputModalities: ["text"],
          capabilities: { aspectRatios: ["1:1", "3:2", "2:3"] },
        },
        requested,
      ),
    ).toMatchObject({
      options: { aspectRatio: "3:2" },
      changes: expect.arrayContaining(["resolution 4K not sent"]),
    });

    expect(
      resolveEffectiveOptions(
        {
          providerId: "openrouter",
          modelId: "recraft/recraft-v3",
          name: "Recraft V3",
          inputModalities: ["text"],
          capabilities: { aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"] },
        },
        requested,
      ),
    ).toMatchObject({
      options: { aspectRatio: "4:3" },
      changes: expect.arrayContaining([
        "resolution 4K not sent",
        "aspect ratio 3:2 -> 4:3",
      ]),
    });
  });

  it("blocks only explicit reference limits", () => {
    const draft = {
      ...createEmptyDraft(),
      models: [
        { providerId: "openrouter", modelId: "limited" },
        { providerId: "openrouter", modelId: "unknown" },
      ],
      referenceAssetIds: ["one", "two"],
    };
    expect(
      getReferenceLimitErrors(draft, [
        {
          providerId: "openrouter",
          modelId: "limited",
          name: "Limited",
          inputModalities: ["text"],
          capabilities: { maxReferenceImages: 1 },
        },
        {
          providerId: "openrouter",
          modelId: "unknown",
          name: "Unknown",
          inputModalities: ["text"],
        },
      ]),
    ).toEqual(["Limited accepts at most 1 reference."]);
  });
});
