import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { readExport, writeExport } from "../../src/lib/migration/io.mjs";
import {
  normalizeLegacyThumbnail,
  writeThumbnailArchiveAsset,
} from "../../src/lib/migration/thumbnail.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("private export envelope", () => {
  it("round-trips checksummed NDJSON collections", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "curio-migration-"));
    temporaryDirectories.push(directory);
    await writeExport(
      directory,
      { entries: [{ id: "one" }], profiles: [] },
      "2026-01-01T00:00:00.000Z",
    );
    const result = await readExport(directory);
    expect(result.collections.entries).toEqual([{ id: "one" }]);
    expect(result.manifest.files.profiles.count).toBe(0);
  });

  it("fails when an exported collection is modified", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "curio-migration-"));
    temporaryDirectories.push(directory);
    await writeExport(directory, { entries: [{ id: "one" }] });
    await fs.appendFile(path.join(directory, "entries.ndjson"), "{}\n");
    await expect(readExport(directory)).rejects.toThrow(/Checksum/u);
  });

  it("round-trips a checksummed private thumbnail without a source URL", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "curio-migration-"));
    temporaryDirectories.push(directory);
    const jpeg = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: "#7c3aed",
      },
    })
      .jpeg()
      .toBuffer();
    const normalized = await normalizeLegacyThumbnail(jpeg);
    const asset = await writeThumbnailArchiveAsset(directory, normalized.buffer);
    await writeExport(
      directory,
      {
        entries: [{ id: "entry-one" }],
        "entry-thumbnails": [{ entryId: "entry-one", assetSha256: asset.sha256 }],
      },
      "2026-01-01T00:00:00.000Z",
      { assets: { thumbnails: [asset] } },
    );

    const rawManifest = await fs.readFile(path.join(directory, "manifest.json"), "utf8");
    const result = await readExport(directory);
    expect(rawManifest).not.toContain("http");
    expect(result.assets.thumbnails[asset.sha256]).toMatchObject({
      bytes: normalized.buffer.byteLength,
      contentType: "image/webp",
    });
  });

  it("rejects a modified archived thumbnail", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "curio-migration-"));
    temporaryDirectories.push(directory);
    const normalized = await normalizeLegacyThumbnail(
      await sharp({
        create: {
          width: 16,
          height: 16,
          channels: 3,
          background: "#111827",
        },
      })
        .png()
        .toBuffer(),
    );
    const asset = await writeThumbnailArchiveAsset(directory, normalized.buffer);
    await writeExport(directory, { entries: [] }, undefined, {
      assets: { thumbnails: [asset] },
    });
    await fs.appendFile(path.join(directory, asset.file), Buffer.from([0]));

    await expect(readExport(directory)).rejects.toThrow(/Checksum/u);
  });
});
