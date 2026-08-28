import type { ImageModel } from "../../shared/contracts.js";

export type ImageProvider = {
  id: string;
  displayName: string;
  listImageModels(signal?: AbortSignal): Promise<ImageModel[]>;
};
