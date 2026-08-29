import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { and, eq } from "drizzle-orm";
import { encode } from "blurhash";
import decodeHeic from "heic-decode";
import sharp, { type Sharp } from "sharp";

import type { Asset } from "../../shared/contracts.js";
import type { AppConfig } from "../config.js";
import type { AppDatabase } from "../db.js";
import { assets } from "../db/schema.js";

const imageTypes = {
  png: { mimeType: "image/png", extension: "png" },
  jpeg: { mimeType: "image/jpeg", extension: "jpg" },
  webp: { mimeType: "image/webp", extension: "webp" },
  svg: { mimeType: "image/svg+xml", extension: "svg" },
} as const;

type ImageType = (typeof imageTypes)[keyof typeof imageTypes];
type AssetRow = typeof assets.$inferSelect;
type ImagePlaceholder = Pick<AssetRow, "width" | "height" | "blurHash">;

export class AssetValidationError extends Error {}

const acceptedUploadMessage = "Upload a JPEG, PNG, WebP, HEIC, or AVIF image.";

function isHeic(bytes: Buffer) {
  if (bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp") {
    return false;
  }
  const heicBrands = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
  for (let offset = 8; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
    if (heicBrands.has(bytes.toString("ascii", offset, offset + 4)))
      return true;
  }
  return false;
}

async function normalizeReference(bytes: Buffer) {
  let image: Sharp;
  if (isHeic(bytes)) {
    const decoded = await decodeHeic({ buffer: bytes });
    image = sharp(Buffer.from(decoded.data), {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
    });
  } else {
    image = sharp(bytes, { failOn: "error" });
    const metadata = await image.metadata();
    if (
      !metadata.format ||
      !["jpeg", "png", "webp", "heif"].includes(metadata.format)
    ) {
      throw new AssetValidationError(acceptedUploadMessage);
    }
    image = image.rotate();
  }

  return image
    .resize({
      width: 1200,
      height: 1200,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 70 })
    .toBuffer();
}

async function createImagePlaceholder(
  bytes: Buffer,
): Promise<ImagePlaceholder> {
  try {
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    const width = metadata.autoOrient.width;
    const height = metadata.autoOrient.height;
    const { data, info } = await sharp(bytes, { failOn: "error" })
      .autoOrient()
      .resize({ width: 32, height: 32, fit: "inside" })
      .flatten({ background: "#ffffff" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return {
      width,
      height,
      blurHash: encode(
        new Uint8ClampedArray(data),
        info.width,
        info.height,
        4,
        3,
      ),
    };
  } catch {
    return { width: null, height: null, blurHash: null };
  }
}

async function createThumbnail(bytes: Buffer) {
  try {
    return await sharp(bytes, { failOn: "error" })
      .resize({
        width: 1000,
        height: 1000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 70 })
      .toBuffer();
  } catch {
    return null;
  }
}

// SVG has no magic number, so the root element is matched after skipping any
// byte-order mark, XML declaration, comments, and doctype.
const svgPrologue = [
  /^\s+/,
  /^<\?[\s\S]*?\?>/,
  /^<!--[\s\S]*?-->/,
  /^<!DOCTYPE[\s\S]*?>/i,
];

function isSvg(bytes: Buffer) {
  let head = bytes
    .subarray(0, 4096)
    .toString("utf8")
    .replace(/^\uFEFF/, "");
  for (let step = 0; step < 16; step += 1) {
    const pattern = svgPrologue.find((candidate) => candidate.test(head));
    if (!pattern) break;
    head = head.replace(pattern, "");
  }
  return /^<svg[\s/>]/i.test(head);
}

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

  if (isSvg(bytes)) {
    return imageTypes.svg;
  }

  return null;
}

// The provider decides the format, so name what arrived instead of leaving the
// unsupported response to guesswork.
function describeSignature(bytes: Buffer) {
  if (!bytes.length) return "empty response";
  return `starts with ${bytes.subarray(0, 8).toString("hex")}`;
}

function assetFromRow(row: AssetRow): Asset {
  return {
    id: row.id,
    sessionId: row.sessionId,
    kind: row.kind,
    mimeType: row.mimeType,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    blurHash: row.blurHash,
    starred: row.starred,
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

      let normalized: Buffer;
      try {
        normalized = await normalizeReference(bytes);
      } catch (error) {
        if (error instanceof AssetValidationError) throw error;
        throw new AssetValidationError(acceptedUploadMessage);
      }

      const id = randomUUID();
      const storagePath = `${id}.jpg`;
      const path = safeAssetPath(config, storagePath);
      const temporaryPath = `${path}.tmp`;
      const placeholder = await createImagePlaceholder(normalized);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temporaryPath, normalized, { flag: "wx" });

      try {
        await rename(temporaryPath, path);
        const row: AssetRow = {
          id,
          ownerId,
          sessionId,
          jobId: null,
          kind: "reference",
          sha256: createHash("sha256").update(normalized).digest("hex"),
          storagePath,
          mimeType: "image/jpeg",
          bytes: normalized.length,
          ...placeholder,
          starred: false,
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
          `The provider returned an unsupported image (${describeSignature(bytes)}).`,
        );
      }
      const id = randomUUID();
      const storagePath = `${id}.${imageType.extension}`;
      const thumbnailStoragePath = `${id}-thumb.webp`;
      const path = safeAssetPath(config, storagePath);
      const thumbnailPath = safeAssetPath(config, thumbnailStoragePath);
      const temporaryPath = `${path}.tmp`;
      const temporaryThumbnailPath = `${thumbnailPath}.tmp`;
      const placeholder = await createImagePlaceholder(bytes);
      const thumbnail = await createThumbnail(bytes);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temporaryPath, bytes, { flag: "wx" });
      if (thumbnail)
        await writeFile(temporaryThumbnailPath, thumbnail, { flag: "wx" });
      try {
        await rename(temporaryPath, path);
        if (thumbnail) await rename(temporaryThumbnailPath, thumbnailPath);
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
          ...placeholder,
          starred: false,
          ordinal,
          createdAt: new Date().toISOString(),
        };
        database.orm.insert(assets).values(row).run();
        return assetFromRow(row);
      } catch (error) {
        await Promise.all([
          rm(path, { force: true }),
          rm(temporaryPath, { force: true }),
          rm(thumbnailPath, { force: true }),
          rm(temporaryThumbnailPath, { force: true }),
        ]);
        throw error;
      }
    },
    async removeFile(storagePath: string) {
      try {
        await rm(safeAssetPath(config, storagePath), { force: true });
        await rm(
          safeAssetPath(config, `${storagePath.split(".")[0]}-thumb.webp`),
          {
            force: true,
          },
        );
      } catch {
        // Missing or inaccessible files must not restore deleted records.
      }
    },
    assetPath(storagePath: string) {
      return safeAssetPath(config, storagePath);
    },
    async thumbnailPath(storagePath: string) {
      const thumbnailStoragePath = `${storagePath.split(".")[0]}-thumb.webp`;
      const thumbnailPath = safeAssetPath(config, thumbnailStoragePath);
      try {
        await access(thumbnailPath);
        return thumbnailPath;
      } catch {
        return safeAssetPath(config, storagePath);
      }
    },
  };
}
