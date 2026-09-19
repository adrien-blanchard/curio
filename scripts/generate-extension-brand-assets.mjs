import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logoPath = path.join(repositoryRoot, "public", "curio-logo.svg");
const iconDirectory = path.join(repositoryRoot, "extension", "icons");
const storeAssetDirectory = path.join(repositoryRoot, "docs", "store-assets");

async function paddedLogo(size, contentHeight) {
  const logo = await sharp(logoPath)
    .resize({ height: contentHeight, fit: "contain", withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: logo.data,
        left: Math.floor((size - logo.info.width) / 2),
        top: Math.floor((size - logo.info.height) / 2),
      },
    ])
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

async function createIcons() {
  await fs.mkdir(iconDirectory, { recursive: true });
  for (const [size, contentHeight] of [
    [16, 14],
    [48, 42],
    [128, 96],
  ]) {
    await fs.writeFile(
      path.join(iconDirectory, `icon-${size}.png`),
      await paddedLogo(size, contentHeight),
    );
  }
}

async function createSmallPromo() {
  await fs.mkdir(storeAssetDirectory, { recursive: true });
  const logo = await paddedLogo(164, 124);
  const background = Buffer.from(`
    <svg width="440" height="280" viewBox="0 0 440 280" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="background" x1="34" y1="18" x2="406" y2="262" gradientUnits="userSpaceOnUse">
          <stop stop-color="#EAF7FF"/>
          <stop offset="1" stop-color="#DCE8FF"/>
        </linearGradient>
        <filter id="shadow" x="102" y="19" width="236" height="236" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#1B254B" flood-opacity="0.14"/>
        </filter>
      </defs>
      <rect width="440" height="280" rx="28" fill="url(#background)"/>
      <circle cx="60" cy="42" r="72" fill="#FFFFFF" fill-opacity="0.45"/>
      <circle cx="402" cy="244" r="100" fill="#0276CA" fill-opacity="0.08"/>
      <g filter="url(#shadow)">
        <rect x="126" y="43" width="188" height="188" rx="42" fill="#FFFFFF"/>
      </g>
    </svg>
  `);
  await sharp(background)
    .composite([{ input: logo, left: 138, top: 55 }])
    .png({ compressionLevel: 9, palette: false })
    .toFile(path.join(storeAssetDirectory, "curio-store-promo-440x280.png"));
}

await createIcons();
await createSmallPromo();
process.stdout.write("Generated Curio extension icons and Chrome Web Store promo asset.\n");
