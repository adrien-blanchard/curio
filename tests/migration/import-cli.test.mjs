import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { writeExport } from "../../src/lib/migration/io.mjs";
import {
  normalizeLegacyThumbnail,
  writeThumbnailArchiveAsset,
} from "../../src/lib/migration/thumbnail.mjs";

const executeFile = promisify(execFile);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("legacy import CLI", () => {
  it("defaults to an offline dry run and writes only a sanitized report", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "curio-import-cli-"));
    temporaryDirectories.push(directory);
    const exportDirectory = path.join(directory, "export");
    const configPath = path.join(directory, "import.config.json");
    const profilesPath = path.join(directory, "target-profiles.json");
    const reportPath = path.join(directory, "report.json");
    const checkpointPath = path.join(directory, "checkpoint.json");

    await writeExport(
      exportDirectory,
      {
        profiles: [{ id: "source-admin", email: "admin@example.invalid", createdAt: null }],
        entries: [
          {
            id: "entry-one",
            url: "https://example.invalid/article",
            canonicalUrl: "https://example.invalid/article",
            title: "Article",
            summary: "Summary",
            sourceType: "opensource",
            status: "ready",
            thumbnailUrl: "https://legacy-images.example.invalid/private-preview.jpg",
            createdBy: "source-admin",
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        tags: [],
        "entry-tags": [],
      },
      "2026-01-01T00:00:00.000Z",
    );
    await fs.writeFile(
      profilesPath,
      JSON.stringify([
        { id: "target-admin", email: "admin@example.invalid", role: "administrator" },
      ]),
    );
    await fs.writeFile(
      configPath,
      JSON.stringify({
        sourceProfileAttributions: [
          {
            sourceProfileId: "source-admin",
            displayName: "Private Legacy Author",
            avatarUrl: "https://lh3.googleusercontent.com/a/private=s96-c",
          },
        ],
      }),
    );

    const scriptPath = path.resolve("scripts/import-legacy.mjs");
    const result = await executeFile(
      process.execPath,
      [
        scriptPath,
        "--config",
        configPath,
        "--input",
        exportDirectory,
        "--target-profiles",
        profilesPath,
        "--report",
        reportPath,
        "--checkpoint",
        checkpointPath,
      ],
      {
        cwd: path.resolve("."),
        env: { ...process.env, INITIAL_ADMIN_EMAILS: "admin@example.invalid" },
      },
    );

    expect(result.stdout).toContain("Dry run complete");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    expect(report).toMatchObject({
      mode: "dry-run",
      plan: {
        canonicalEntries: 1,
        duplicateEntriesMerged: 0,
        thumbnailPolicy: "verified_private_archive_with_placeholder_fallback",
        archivedThumbnails: 0,
        unavailableThumbnails: 1,
        historicalAttributions: 1,
        ownerFallbackAttributions: 0,
      },
      result: { applied: 0, placeholdersAssigned: 0, attributionsRestored: 0 },
    });
    expect(result.stdout).toContain("Thumbnail plan: 0 archived, 1 placeholders.");
    expect(JSON.stringify(report)).not.toContain("https://example.invalid/article");
    expect(JSON.stringify(report)).not.toContain("legacy-images.example.invalid");
    expect(JSON.stringify(report)).not.toContain("admin@example.invalid");
    expect(JSON.stringify(report)).not.toContain("Private Legacy Author");
    expect(JSON.stringify(report)).not.toContain("lh3.googleusercontent.com");
    await expect(fs.access(checkpointPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not expose a legacy thumbnail-copy option", async () => {
    const scriptPath = path.resolve("scripts/import-legacy.mjs");
    const result = await executeFile(process.execPath, [scriptPath, "--help"], {
      cwd: path.resolve("."),
    });
    expect(result.stdout).not.toContain("copy-thumbnails");
    expect(result.stdout).not.toContain("thumbnail bucket");
  });

  it("validates and counts normalized archived thumbnails during dry-run", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "curio-import-cli-"));
    temporaryDirectories.push(directory);
    const exportDirectory = path.join(directory, "export");
    const profilesPath = path.join(directory, "target-profiles.json");
    const reportPath = path.join(directory, "report.json");
    const checkpointPath = path.join(directory, "checkpoint.json");
    await fs.mkdir(exportDirectory, { recursive: true });
    const normalized = await normalizeLegacyThumbnail(
      await sharp({
        create: {
          width: 32,
          height: 32,
          channels: 3,
          background: "#0f766e",
        },
      })
        .png()
        .toBuffer(),
    );
    const asset = await writeThumbnailArchiveAsset(exportDirectory, normalized.buffer);
    await writeExport(
      exportDirectory,
      {
        profiles: [{ id: "source-admin", email: "admin@example.invalid" }],
        entries: [
          {
            id: "entry-one",
            url: "https://example.invalid/article",
            sourceType: "opensource",
            status: "ready",
            createdBy: "source-admin",
          },
        ],
        tags: [],
        "entry-tags": [],
        "entry-thumbnails": [{ entryId: "entry-one", assetSha256: asset.sha256 }],
      },
      "2026-01-01T00:00:00.000Z",
      { assets: { thumbnails: [asset] } },
    );
    await fs.writeFile(
      profilesPath,
      JSON.stringify([
        { id: "target-admin", email: "admin@example.invalid", role: "administrator" },
      ]),
    );

    await executeFile(
      process.execPath,
      [
        path.resolve("scripts/import-legacy.mjs"),
        "--input",
        exportDirectory,
        "--target-profiles",
        profilesPath,
        "--report",
        reportPath,
        "--checkpoint",
        checkpointPath,
      ],
      {
        cwd: path.resolve("."),
        env: { ...process.env, INITIAL_ADMIN_EMAILS: "admin@example.invalid" },
      },
    );

    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    expect(report.plan).toMatchObject({
      archivedThumbnails: 1,
      unavailableThumbnails: 0,
    });
  });

  it("rejects a checksummed file that is not a real normalized WebP", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "curio-import-cli-"));
    temporaryDirectories.push(directory);
    const exportDirectory = path.join(directory, "export");
    await fs.mkdir(exportDirectory, { recursive: true });
    const asset = await writeThumbnailArchiveAsset(
      exportDirectory,
      Buffer.from("forged WebP payload"),
    );
    await writeExport(
      exportDirectory,
      {
        entries: [
          {
            id: "entry-one",
            url: "https://example.invalid/article",
            sourceType: "opensource",
            status: "ready",
          },
        ],
        "entry-thumbnails": [{ entryId: "entry-one", assetSha256: asset.sha256 }],
      },
      "2026-01-01T00:00:00.000Z",
      { assets: { thumbnails: [asset] } },
    );

    await expect(
      executeFile(process.execPath, [
        path.resolve("scripts/import-legacy.mjs"),
        "--input",
        exportDirectory,
      ]),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("THUMBNAIL_ARCHIVE_INVALID") });
  });
});
