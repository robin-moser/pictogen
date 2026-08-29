import { eq } from "drizzle-orm";

import type { AppDatabase } from "../db.js";
import {
  assets,
  generationJobs,
  generationRuns,
  sessions,
  users,
} from "../db/schema.js";
import type { createAssetService } from "./assets.js";

type AssetService = ReturnType<typeof createAssetService>;

export async function deleteUserAccount(
  database: AppDatabase,
  assetService: AssetService,
  userId: string,
) {
  const ownedAssets = database.orm
    .select({ storagePath: assets.storagePath })
    .from(assets)
    .where(eq(assets.ownerId, userId))
    .all();

  database.orm.transaction((tx) => {
    tx.delete(sessions).where(eq(sessions.ownerId, userId)).run();
    tx.delete(generationJobs).where(eq(generationJobs.ownerId, userId)).run();
    tx.delete(generationRuns).where(eq(generationRuns.ownerId, userId)).run();
    tx.delete(assets).where(eq(assets.ownerId, userId)).run();
    tx.delete(users).where(eq(users.id, userId)).run();
  });

  await Promise.all(
    ownedAssets.map((asset) => assetService.removeFile(asset.storagePath)),
  );
}
