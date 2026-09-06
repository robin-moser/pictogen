import { describe, expect, it } from "vitest";

import {
  compareImageModels,
  placeModelHint,
} from "../client/components/SettingsSidebar.js";
import type { ImageModel } from "../shared/contracts.js";

function model(modelId: string, details: Partial<ImageModel> = {}): ImageModel {
  return {
    providerId: "openrouter",
    modelId,
    name: modelId,
    inputModalities: ["text"],
    ...details,
  };
}

describe("model sorting", () => {
  it("keeps unranked models after ranked models", () => {
    const models = [
      model("unranked"),
      model("ranked", {
        benchmarks: {
          designArena: [{ category: "text-to-image", rank: 2 }],
        },
      }),
    ];

    models.sort((left, right) =>
      compareImageModels(left, right, "design-arena:text-to-image"),
    );

    expect(models.map(({ modelId }) => modelId)).toEqual([
      "ranked",
      "unranked",
    ]);
  });

  it("sorts only explicit per-image prices", () => {
    const models = [
      model("aaa-token-rate", {
        displayPricing: [
          { label: "Image output", price: 10, unit: "/M tokens" },
        ],
      }),
      model("zzz-per-image", {
        displayPricing: [{ label: "Output", price: 0.04, unit: "/image" }],
      }),
    ];

    models.sort((left, right) => compareImageModels(left, right, "pricing"));

    expect(models.map(({ modelId }) => modelId)).toEqual([
      "zzz-per-image",
      "aaa-token-rate",
    ]);
  });
});

describe("model detail popover placement", () => {
  it("flips horizontally and clamps long content to the viewport", () => {
    expect(
      placeModelHint(
        { left: 900, right: 1_000, top: 8, height: 44 },
        { width: 384, height: 600 },
        { width: 1_200, height: 700 },
      ),
    ).toEqual({ left: 504, top: 16, maxHeight: 668 });

    const narrowPlacement = placeModelHint(
      { left: 8, right: 108, top: 640, height: 44 },
      { width: 368, height: 600 },
      { width: 400, height: 700 },
    );
    expect(narrowPlacement).toEqual({ left: 16, top: 28, maxHeight: 612 });
    expect(
      narrowPlacement.top + Math.min(600, narrowPlacement.maxHeight),
    ).toBeLessThanOrEqual(640 - 12);

    expect(
      placeModelHint(
        { left: 10, right: 110, top: 300, height: 44 },
        { width: 200, height: 100 },
        { width: 800, height: 700 },
      ),
    ).toEqual({ left: 122, top: 272, maxHeight: 668 });
  });
});
