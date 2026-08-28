import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { and, eq } from "drizzle-orm";

import type { Asset } from "../../shared/contracts.js";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import { assets } from "../db/schema.js";

const imageTypes = {
  png: { mimeType: "image/png", extension: "png" },
  jpeg: { mimeType: "image/jpeg", extension: "jpg" },
  webp: { mimeType: "image/webp", extension: "webp" },
} as const;

type ImageType = (typeof imageTypes)[keyof typeof imageTypes];
type AssetRow = typeof assets.$inferSelect;

export class AssetValidationError extends Error {}

export function detectImageType(bytes: Buffer): ImageType | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return imageTypes.png;
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  ) {
    return imageTypes.jpeg;
  }

  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    bytes.subarray(8, 12).equals(Buffer.from("WEBP"))
  ) {
    return imageTypes.webp;
  }

  return null;
}

function assetFromRow(row: AssetRow): Asset {
  return {
    id: row.id,
    sessionId: row.sessionId,
    kind: row.kind,
    mimeType: row.mimeType,
    bytes: row.bytes,
    createdAt: row.createdAt,
  };
}

function safeAssetPath(config: AppConfig, storagePath: string) {
  const root = resolve(config.dataDir, "assets");
  const path = resolve(root, storagePath);
  if (!path.startsWith(`${root}${sep}`)) {
    throw new Error("Invalid asset storage path.");
  }
  return path;
}

export function createAssetService(config: AppConfig, database: AppDatabase) {
  return {
    assetFromRow,
    listReferences(sessionId: string, ownerId: string) {
      return database.orm
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.sessionId, sessionId),
            eq(assets.ownerId, ownerId),
            eq(assets.kind, "reference"),
          ),
        )
        .all()
        .map(assetFromRow);
    },
    findOwnedAsset(assetId: string, ownerId: string) {
      return database.orm
        .select()
        .from(assets)
        .where(and(eq(assets.id, assetId), eq(assets.ownerId, ownerId)))
        .get();
    },
    async createReference(sessionId: string, ownerId: string, bytes: Buffer) {
      if (bytes.length > config.maxUploadBytes) {
        throw new AssetValidationError(
          "The image exceeds the upload size limit.",
        );
      }

      const imageType = detectImageType(bytes);
      if (!imageType) {
        throw new AssetValidationError("Upload a PNG, JPEG, or WebP image.");
      }

      const id = randomUUID();
      const storagePath = `${id}.${imageType.extension}`;
      const path = safeAssetPath(config, storagePath);
      const temporaryPath = `${path}.tmp`;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temporaryPath, bytes, { flag: "wx" });

      try {
        await rename(temporaryPath, path);
        const row: AssetRow = {
          id,
          ownerId,
          sessionId,
          jobId: null,
          kind: "reference",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          storagePath,
          mimeType: imageType.mimeType,
          bytes: bytes.length,
          ordinal: null,
          createdAt: new Date().toISOString(),
        };
        database.orm.insert(assets).values(row).run();
        return assetFromRow(row);
      } catch (error) {
        await Promise.all([
          rm(path, { force: true }),
          rm(temporaryPath, { force: true }),
        ]);
        throw error;
      }
    },
    async createOutput(
      sessionId: string,
      ownerId: string,
      jobId: string,
      ordinal: number,
      bytes: Buffer,
    ) {
      const imageType = detectImageType(bytes);
      if (!imageType) {
        throw new AssetValidationError(
          "The provider returned an unsupported image.",
        );
      }
      const id = randomUUID();
      const storagePath = `${id}.${imageType.extension}`;
      const path = safeAssetPath(config, storagePath);
      const temporaryPath = `${path}.tmp`;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temporaryPath, bytes, { flag: "wx" });
      try {
        await rename(temporaryPath, path);
        const row = {
          id,
          ownerId,
          sessionId,
          jobId,
          kind: "output" as const,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          storagePath,
          mimeType: imageType.mimeType,
          bytes: bytes.length,
          ordinal,
          createdAt: new Date().toISOString(),
        };
        database.orm.insert(assets).values(row).run();
        return assetFromRow(row);
      } catch (error) {
        await Promise.all([
          rm(path, { force: true }),
          rm(temporaryPath, { force: true }),
        ]);
        throw error;
      }
    },
    async removeFile(storagePath: string) {
      try {
        await rm(safeAssetPath(config, storagePath), { force: true });
      } catch {
        // Missing or inaccessible files must not restore deleted records.
      }
    },
    assetPath(storagePath: string) {
      return safeAssetPath(config, storagePath);
    },
  };
}
