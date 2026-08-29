import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";

const assetsDirectory = resolve(process.env.DATA_DIR ?? "data", "assets");
const files = await readdir(assetsDirectory);
const originals = files.filter(
  (file) =>
    /\.(png|jpg|jpeg|webp|svg)$/i.test(file) && !file.includes("-thumb."),
);

let regenerated = 0;
for (const file of originals) {
  const thumbnail = await sharp(await readFile(resolve(assetsDirectory, file)))
    .resize({
      width: 1000,
      height: 1000,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 70 })
    .toBuffer();
  const thumbnailPath = resolve(
    assetsDirectory,
    `${file.replace(/\.[^.]+$/, "")}-thumb.webp`,
  );
  const temporaryPath = `${thumbnailPath}.tmp`;
  await writeFile(temporaryPath, thumbnail);
  await rename(temporaryPath, thumbnailPath);
  regenerated += 1;
}

console.log(
  `Regenerated ${regenerated} thumbnail${regenerated === 1 ? "" : "s"}.`,
);
