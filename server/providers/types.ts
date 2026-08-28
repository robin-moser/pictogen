import type { ImageModel } from "../../shared/contracts.js";

export type ImageProvider = {
  id: string;
  displayName: string;
  listImageModels(signal?: AbortSignal): Promise<ImageModel[]>;
  generateImages?: (
    request: {
      modelId: string;
      prompt: string;
      count: number;
      resolution?: string;
      aspectRatio?: string;
      references: Array<{ mimeType: string; bytes: Buffer }>;
    },
    signal?: AbortSignal,
  ) => Promise<{
    images: Buffer[];
    usage?: { cost?: number; [key: string]: unknown };
  }>;
};
