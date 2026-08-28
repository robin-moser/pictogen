import type { ImageModel, SessionDraft } from "./contracts.js";

const resolutions = ["512", "1K", "2K", "4K"] as const;
const aspectRatios = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
] as const;

type RequestedOptions = Pick<
  SessionDraft,
  | "resolution"
  | "aspectRatio"
  | "quality"
  | "background"
  | "outputFormat"
  | "outputCompression"
>;

export type EffectiveGenerationOptions = Partial<RequestedOptions>;

function nearestResolution(
  requested: SessionDraft["resolution"],
  allowed: SessionDraft["resolution"][],
) {
  const requestedIndex = resolutions.indexOf(requested);
  const lower = allowed
    .filter((value) => resolutions.indexOf(value) < requestedIndex)
    .sort(
      (left, right) => resolutions.indexOf(right) - resolutions.indexOf(left),
    )[0];
  return (
    lower ??
    [...allowed].sort(
      (left, right) => resolutions.indexOf(left) - resolutions.indexOf(right),
    )[0]
  );
}

function ratio(value: SessionDraft["aspectRatio"]) {
  const [width, height] = value.split(":").map(Number);
  return Math.log((width ?? 1) / (height ?? 1));
}

function nearestAspectRatio(
  requested: SessionDraft["aspectRatio"],
  allowed: SessionDraft["aspectRatio"][],
) {
  return [...allowed].sort(
    (left, right) =>
      Math.abs(ratio(left) - ratio(requested)) -
        Math.abs(ratio(right) - ratio(requested)) ||
      aspectRatios.indexOf(left) - aspectRatios.indexOf(right),
  )[0];
}

export function resolveEffectiveOptions(
  model: ImageModel,
  requested: RequestedOptions,
) {
  const options: EffectiveGenerationOptions = {};
  const changes: string[] = [];
  const capabilities = model.capabilities;

  if (capabilities?.resolutions) {
    const effective = capabilities.resolutions.includes(requested.resolution)
      ? requested.resolution
      : nearestResolution(requested.resolution, capabilities.resolutions);
    if (effective) options.resolution = effective;
    if (effective !== requested.resolution)
      changes.push(
        effective
          ? `resolution ${requested.resolution} -> ${effective}`
          : `resolution ${requested.resolution} not sent`,
      );
  } else {
    changes.push(`resolution ${requested.resolution} not sent`);
  }

  if (capabilities?.aspectRatios) {
    const effective = capabilities.aspectRatios.includes(requested.aspectRatio)
      ? requested.aspectRatio
      : nearestAspectRatio(requested.aspectRatio, capabilities.aspectRatios);
    if (effective) options.aspectRatio = effective;
    if (effective !== requested.aspectRatio)
      changes.push(
        effective
          ? `aspect ratio ${requested.aspectRatio} -> ${effective}`
          : `aspect ratio ${requested.aspectRatio} not sent`,
      );
  } else {
    changes.push(`aspect ratio ${requested.aspectRatio} not sent`);
  }

  if (requested.quality) {
    if (capabilities?.qualities?.includes(requested.quality)) {
      options.quality = requested.quality;
    } else {
      changes.push(`quality ${requested.quality} not sent`);
    }
  }

  if (requested.background) {
    if (capabilities?.backgrounds?.includes(requested.background)) {
      options.background = requested.background;
    } else {
      changes.push(`background ${requested.background} not sent`);
    }
  }

  if (requested.outputFormat) {
    if (capabilities?.outputFormats?.includes(requested.outputFormat)) {
      options.outputFormat = requested.outputFormat;
    } else {
      changes.push(`output format ${requested.outputFormat} not sent`);
    }
  }

  if (requested.outputCompression !== undefined) {
    const range = capabilities?.outputCompression;
    if (range) {
      const effective = Math.min(
        range.maximum,
        Math.max(range.minimum, requested.outputCompression),
      );
      options.outputCompression = effective;
      if (effective !== requested.outputCompression)
        changes.push(
          `output compression ${requested.outputCompression} -> ${effective}`,
        );
    } else {
      changes.push(
        `output compression ${requested.outputCompression} not sent`,
      );
    }
  }

  return { options, changes };
}

export function getReferenceLimitErrors(
  draft: SessionDraft,
  models: ImageModel[],
) {
  const referenceCount = draft.referenceAssetIds.length;
  if (!referenceCount) return [];

  return draft.models.flatMap((selection) => {
    const model = models.find(
      (candidate) =>
        candidate.providerId === selection.providerId &&
        candidate.modelId === selection.modelId,
    );
    if (!model) return [];
    const maximum = model.capabilities?.maxReferenceImages;
    if (maximum === undefined || referenceCount <= maximum) return [];
    return [
      `${model.name} accepts at most ${maximum} reference${maximum === 1 ? "" : "s"}.`,
    ];
  });
}
