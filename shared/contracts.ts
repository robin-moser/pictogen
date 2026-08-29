import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";

export const ModelSelectionSchema = Type.Object(
  {
    providerId: Type.String({ minLength: 1, maxLength: 100 }),
    modelId: Type.String({ minLength: 1, maxLength: 300 }),
  },
  { additionalProperties: false },
);

export const ResolutionSchema = Type.Union([
  Type.Literal("512"),
  Type.Literal("1K"),
  Type.Literal("2K"),
  Type.Literal("4K"),
]);

export const AspectRatioSchema = Type.Union([
  Type.Literal("1:1"),
  Type.Literal("16:9"),
  Type.Literal("9:16"),
  Type.Literal("4:3"),
  Type.Literal("3:4"),
  Type.Literal("3:2"),
  Type.Literal("2:3"),
]);

export const QualitySchema = Type.Union([
  Type.Literal("auto"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
]);

export const BackgroundSchema = Type.Union([
  Type.Literal("auto"),
  Type.Literal("transparent"),
  Type.Literal("opaque"),
]);

export const OutputFormatSchema = Type.Union([
  Type.Literal("png"),
  Type.Literal("jpeg"),
  Type.Literal("webp"),
]);

export const promptModifierValues = {
  shot: [
    ", extreme close-up",
    ", low-angle shot",
    ", high-angle shot",
    ", aerial shot",
    ", close-up shot",
    ", close-up portrait",
    ", macro shot",
    ", wide-angle shot",
    ", establishing shot",
    ", over-the-shoulder shot",
    ", telephoto shot",
    ", handheld shot",
    ", panoramic shot",
    ", dramatic angle, extreme angle shot",
  ],
  color: [
    ", vibrant color grading",
    ", warm color grading",
    ", cool-toned color grading",
    ", pastel color grading",
    ", bright color grading",
    ", muted color grading",
    ", neon color grading",
    ", duotone color grading",
    ", monochrome",
    ", cool-toned sterile colors",
  ],
  effect: [
    ", bokeh",
    ", tilt-shift effect",
    ", soft focus",
    ", shallow depth of field",
    ", chromatic aberrations",
    ", light leaks",
    ", rear projection",
    ", lens flare",
    ", long exposure",
    ", golden hour",
    ", silhouette",
  ],
} as const;

function promptModifierSchema(values: readonly string[]) {
  return Type.Union(values.map((value) => Type.Literal(value)));
}

export const PromptModifiersSchema = Type.Object(
  {
    shot: Type.Optional(promptModifierSchema(promptModifierValues.shot)),
    color: Type.Optional(promptModifierSchema(promptModifierValues.color)),
    effect: Type.Optional(promptModifierSchema(promptModifierValues.effect)),
  },
  { additionalProperties: false },
);

export const SessionDraftSchema = Type.Object(
  {
    prompt: Type.String({ maxLength: 12_000 }),
    promptModifiers: PromptModifiersSchema,
    models: Type.Array(ModelSelectionSchema),
    resolution: ResolutionSchema,
    aspectRatio: AspectRatioSchema,
    quality: Type.Optional(QualitySchema),
    background: Type.Optional(BackgroundSchema),
    outputFormat: Type.Optional(OutputFormatSchema),
    outputCompression: Type.Optional(
      Type.Integer({ minimum: 0, maximum: 100 }),
    ),
    count: Type.Integer({ minimum: 1, maximum: 10 }),
    referenceAssetIds: Type.Array(Type.String({ minLength: 1 }), {
      maxItems: 20,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export type SessionDraft = Static<typeof SessionDraftSchema>;

export function composePrompt(draft: SessionDraft): string {
  const { shot, color, effect } = draft.promptModifiers;
  return `${draft.prompt}${shot ?? ""}${color ?? ""}${effect ?? ""}`;
}

export function normalizeSessionDraft(draft: SessionDraft): SessionDraft {
  if (draft.promptModifiers) return draft;

  let prompt = draft.prompt;
  const promptModifiers: SessionDraft["promptModifiers"] = {};
  for (const key of ["effect", "color", "shot"] as const) {
    const value = promptModifierValues[key].find((candidate) =>
      prompt.endsWith(candidate),
    );
    if (value) {
      promptModifiers[key] = value;
      prompt = prompt.slice(0, -value.length);
    }
  }

  return { ...draft, prompt, promptModifiers };
}

export const AssetSchema = Type.Object(
  {
    id: Type.String(),
    sessionId: Type.String(),
    kind: Type.Union([Type.Literal("reference"), Type.Literal("output")]),
    mimeType: Type.Union([
      Type.Literal("image/png"),
      Type.Literal("image/jpeg"),
      Type.Literal("image/webp"),
      Type.Literal("image/svg+xml"),
    ]),
    bytes: Type.Integer({ minimum: 0 }),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);

export type Asset = Static<typeof AssetSchema>;

export const JobStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);
export type JobStatus = Static<typeof JobStatusSchema>;

export const GenerationJobSchema = Type.Object(
  {
    id: Type.String(),
    runId: Type.String(),
    providerId: Type.String(),
    modelId: Type.String(),
    modelName: Type.String(),
    effectiveOptions: Type.Object(
      {
        resolution: Type.Optional(ResolutionSchema),
        aspectRatio: Type.Optional(AspectRatioSchema),
        quality: Type.Optional(QualitySchema),
        background: Type.Optional(BackgroundSchema),
        outputFormat: Type.Optional(OutputFormatSchema),
        outputCompression: Type.Optional(
          Type.Integer({ minimum: 0, maximum: 100 }),
        ),
      },
      { additionalProperties: false },
    ),
    requestedCount: Type.Integer(),
    completedCount: Type.Integer(),
    status: JobStatusSchema,
    costMicrousd: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    costComplete: Type.Boolean(),
    errorMessage: Type.Optional(Type.String()),
    createdAt: Type.String(),
    referenceAssetIds: Type.Array(Type.String()),
    outputs: Type.Array(AssetSchema),
  },
  { additionalProperties: false },
);
export type GenerationJob = Static<typeof GenerationJobSchema>;

export const GenerationRunSchema = Type.Object(
  {
    id: Type.String(),
    prompt: Type.String(),
    options: Type.Object({
      resolution: ResolutionSchema,
      aspectRatio: AspectRatioSchema,
      quality: Type.Optional(QualitySchema),
      background: Type.Optional(BackgroundSchema),
      outputFormat: Type.Optional(OutputFormatSchema),
      outputCompression: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 100 }),
      ),
    }),
    requestedCount: Type.Integer(),
    createdAt: Type.String(),
    jobs: Type.Array(GenerationJobSchema),
  },
  { additionalProperties: false },
);
export type GenerationRun = Static<typeof GenerationRunSchema>;

export const CreateRunSchema = Type.Object(
  {
    prompt: Type.String({ minLength: 1, maxLength: 12_000 }),
    models: Type.Array(ModelSelectionSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    count: Type.Integer({ minimum: 1, maximum: 10 }),
    options: Type.Object({
      resolution: ResolutionSchema,
      aspectRatio: AspectRatioSchema,
      quality: Type.Optional(QualitySchema),
      background: Type.Optional(BackgroundSchema),
      outputFormat: Type.Optional(OutputFormatSchema),
      outputCompression: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 100 }),
      ),
    }),
    referenceAssetIds: Type.Array(Type.String({ minLength: 1 }), {
      maxItems: 20,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
export type CreateRun = Static<typeof CreateRunSchema>;

export const ImageModelSchema = Type.Object(
  {
    providerId: Type.String(),
    modelId: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    inputModalities: Type.Array(
      Type.Union([Type.Literal("text"), Type.Literal("image")]),
    ),
    capabilities: Type.Optional(
      Type.Object(
        {
          referenceImages: Type.Optional(Type.Boolean()),
          maxReferenceImages: Type.Optional(Type.Integer({ minimum: 0 })),
          maxImagesPerRequest: Type.Optional(Type.Integer({ minimum: 1 })),
          resolutions: Type.Optional(Type.Array(ResolutionSchema)),
          aspectRatios: Type.Optional(Type.Array(AspectRatioSchema)),
          qualities: Type.Optional(Type.Array(QualitySchema)),
          backgrounds: Type.Optional(Type.Array(BackgroundSchema)),
          outputFormats: Type.Optional(Type.Array(OutputFormatSchema)),
          outputCompression: Type.Optional(
            Type.Object({
              minimum: Type.Integer({ minimum: 0, maximum: 100 }),
              maximum: Type.Integer({ minimum: 0, maximum: 100 }),
            }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export type ImageModel = Static<typeof ImageModelSchema>;

export const ModelCatalogSchema = Type.Object(
  {
    models: Type.Array(ImageModelSchema),
    fetchedAt: Type.String(),
    stale: Type.Boolean(),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type ModelCatalog = Static<typeof ModelCatalogSchema>;

export const SessionSummarySchema = Type.Object(
  {
    id: Type.String(),
    title: Type.String(),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    knownCostMicrousd: Type.Integer({ minimum: 0 }),
    costComplete: Type.Boolean(),
    activeJobCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type SessionSummary = Static<typeof SessionSummarySchema>;

export const SessionDetailSchema = Type.Intersect([
  SessionSummarySchema,
  Type.Object(
    {
      draft: SessionDraftSchema,
      references: Type.Array(AssetSchema),
      runs: Type.Array(GenerationRunSchema),
    },
    { additionalProperties: false },
  ),
]);

export type SessionDetail = Static<typeof SessionDetailSchema>;

export const ErrorResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
  }),
});

export function createEmptyDraft(): SessionDraft {
  return {
    prompt: "",
    promptModifiers: {},
    models: [],
    resolution: "1K",
    aspectRatio: "1:1",
    count: 1,
    referenceAssetIds: [],
  };
}
