import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const source = path.resolve("artifacts/product-tour");
const destination = path.resolve("docs/media/v002");
await mkdir(destination, { recursive: true });
for (const name of [
  "01-dashboard",
  "02-entry-detail",
  "03-entry-editor",
  "04-tags-and-topics",
  "05-members",
  "06-chrome-extension",
]) {
  await sharp(path.join(source, `${name}.png`))
    .webp({ quality: 88 })
    .toFile(path.join(destination, `${name}.webp`));
  await sharp(path.join(source, `${name}.png`))
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
    .toFile(path.join(destination, `${name}.jpg`));
}
for (const extension of ["mp4", "srt"]) {
  await copyFile(
    path.join(source, `curio-tour-38s.en.${extension}`),
    path.join(destination, `curio-tour.en.${extension}`),
  );
}
await copyFile(
  path.join(source, "curio-tour-38s-clean.mp4"),
  path.join(destination, "curio-tour-clean.mp4"),
);
for (const name of ["curio-music-38s.wav", "curio-music-38s.mp3", "edit-timeline.json"]) {
  await copyFile(path.join(source, name), path.join(destination, name));
}
console.log("Prepared product media in docs/media/v002. Version v001 is unchanged.");
