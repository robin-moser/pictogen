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

export const SessionDraftSchema = Type.Object(
  {
    prompt: Type.String({ maxLength: 12_000 }),
    models: Type.Array(ModelSelectionSchema, { maxItems: 3 }),
    resolution: ResolutionSchema,
    aspectRatio: AspectRatioSchema,
    count: Type.Integer({ minimum: 1, maximum: 10 }),
    referenceAssetIds: Type.Array(Type.String({ minLength: 1 }), {
      maxItems: 20,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);

export type SessionDraft = Static<typeof SessionDraftSchema>;

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
    models: [],
    resolution: "1K",
    aspectRatio: "1:1",
    count: 1,
    referenceAssetIds: [],
  };
}
