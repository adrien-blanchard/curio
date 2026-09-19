import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyArchivedThumbnail,
  classifyLegacyThumbnailReference,
  downloadLegacyThumbnail,
  MAX_THUMBNAIL_BYTES,
  normalizeLegacyThumbnail,
  writeThumbnailArchiveAsset,
} from "../../src/lib/migration/thumbnail.mjs";

const SOURCE_URL = "https://legacy-project.supabase.co";
const TARGET_ENTRY_ID = "11111111-1111-4111-8111-111111111111";
const temporaryDirectories = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function archivedAsset() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "curio-thumbnail-"));
  temporaryDirectories.push(directory);
  const input = await sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: "#2563eb",
    },
  })
    .jpeg()
    .toBuffer();
  const normalized = await normalizeLegacyThumbnail(input);
  const asset = await writeThumbnailArchiveAsset(directory, normalized.buffer);
  return { ...asset, absolutePath: path.join(directory, asset.file) };
}

function targetClient({ failLink = false } = {}) {
  const calls = { updates: [], uploads: [], removals: [] };
  const client = {
    from(table) {
      expect(table).toBe("entries");
      return {
        update(values) {
          return {
            async eq(column, value) {
              calls.updates.push({ values, column, value });
              return { error: failLink && values.thumbnail_path ? new Error("link") : null };
            },
          };
        },
      };
    },
    storage: {
      from(bucket) {
        expect(bucket).toBe("thumbnails");
        return {
          async upload(objectPath, buffer, options) {
            calls.uploads.push({ objectPath, buffer, options });
            return { error: null };
          },
          async remove(objectPaths) {
            calls.removals.push(objectPaths);
            return { error: null };
          },
        };
      },
    },
  };
  return { client, calls };
}

describe("legacy thumbnail allowlist", () => {
  it("accepts only source Storage objects or the two fixed image hosts", () => {
    expect(
      classifyLegacyThumbnailReference(
        `${SOURCE_URL}/storage/v1/object/public/thumbnails/folder/image.jpg?token=ignored`,
        SOURCE_URL,
      ),
    ).toEqual({ kind: "storage", objectPath: "folder/image.jpg" });
    expect(classifyLegacyThumbnailReference("thumbnails/folder/image.jpg", SOURCE_URL)).toEqual({
      kind: "storage",
      objectPath: "folder/image.jpg",
    });
    expect(
      classifyLegacyThumbnailReference(
        "https://i.ytimg.com/vi/video/default.jpg?tracking=removed",
        SOURCE_URL,
      ),
    ).toEqual({
      kind: "trusted-remote",
      url: "https://i.ytimg.com/vi/video/default.jpg",
    });
    expect(
      classifyLegacyThumbnailReference(
        "https://opengraph.githubassets.com/hash/org/repo",
        SOURCE_URL,
      )?.kind,
    ).toBe("trusted-remote");
    expect(
      classifyLegacyThumbnailReference("https://images.example.com/a.jpg", SOURCE_URL),
    ).toBeNull();
    expect(
      classifyLegacyThumbnailReference(`${SOURCE_URL}/not-storage/a.jpg`, SOURCE_URL),
    ).toBeNull();
  });

  it("uses the authenticated source Storage API and disables redirects", async () => {
    const fetcher = vi.fn(async () => new Response(Buffer.from("image-bytes")));
    await downloadLegacyThumbnail("thumbnails/folder/image.jpg", {
      sourceUrl: SOURCE_URL,
      serviceRoleKey: "private-test-key",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      `${SOURCE_URL}/storage/v1/object/authenticated/thumbnails/folder/image.jpg`,
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
  });

  it("rejects redirects and enforces the streamed 5 MiB ceiling", async () => {
    await expect(
      downloadLegacyThumbnail("https://i.ytimg.com/redirect.jpg", {
        sourceUrl: SOURCE_URL,
        serviceRoleKey: "unused",
        fetcher: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://images.example.com/private.jpg" },
          }),
      }),
    ).rejects.toMatchObject({ code: "REDIRECT_NOT_ALLOWED" });

    const chunk = new Uint8Array(Math.floor(MAX_THUMBNAIL_BYTES / 2) + 1);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    await expect(
      downloadLegacyThumbnail("https://i.ytimg.com/oversized.jpg", {
        sourceUrl: SOURCE_URL,
        serviceRoleKey: "unused",
        fetcher: async () => new Response(body),
      }),
    ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });
});

describe("legacy thumbnail normalization and apply", () => {
  it("detects the real image type and normalizes it to a single 720x309 WebP", async () => {
    const png = await sharp({
      create: {
        width: 20,
        height: 30,
        channels: 4,
        background: "#16a34a",
      },
    })
      .png()
      .toBuffer();
    const result = await normalizeLegacyThumbnail(png);
    const metadata = await sharp(result.buffer).metadata();

    expect(metadata).toMatchObject({ format: "webp", width: 720, height: 309 });
    await expect(
      normalizeLegacyThumbnail(Buffer.from("not really an image")),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });

  it("uploads deterministically, links the target entry, and removes its old object", async () => {
    const asset = await archivedAsset();
    const { client, calls } = targetClient();
    const previousThumbnailPath = `${TARGET_ENTRY_ID}/old.webp`;
    const result = await applyArchivedThumbnail({
      client,
      entryId: TARGET_ENTRY_ID,
      previousThumbnailPath,
      asset,
    });
    const expectedPath = `${TARGET_ENTRY_ID}/migration-${asset.sha256}.webp`;

    expect(result).toEqual({
      status: "succeeded",
      objectPath: expectedPath,
      cleanupFailed: false,
    });
    expect(calls.uploads[0]).toMatchObject({
      objectPath: expectedPath,
      options: { contentType: "image/webp", upsert: true },
    });
    expect(calls.updates).toContainEqual({
      values: { thumbnail_path: expectedPath },
      column: "id",
      value: TARGET_ENTRY_ID,
    });
    expect(calls.removals).toContainEqual([previousThumbnailPath]);
  });

  it("assigns a null placeholder when an archived image is falsified", async () => {
    const asset = await archivedAsset();
    await fs.writeFile(asset.absolutePath, Buffer.from("forged"));
    const { client, calls } = targetClient();
    const previousThumbnailPath = `${TARGET_ENTRY_ID}/old.webp`;
    const result = await applyArchivedThumbnail({
      client,
      entryId: TARGET_ENTRY_ID,
      previousThumbnailPath,
      asset,
    });

    expect(result).toEqual({
      status: "failed",
      placeholderAssigned: true,
      cleanupFailed: false,
    });
    expect(calls.uploads).toHaveLength(0);
    expect(calls.updates).toContainEqual({
      values: { thumbnail_path: null },
      column: "id",
      value: TARGET_ENTRY_ID,
    });
    expect(calls.removals).toContainEqual([previousThumbnailPath]);
  });

  it("cleans the staged and previous objects when linking the upload fails", async () => {
    const asset = await archivedAsset();
    const { client, calls } = targetClient({ failLink: true });
    const previousThumbnailPath = `${TARGET_ENTRY_ID}/old.webp`;
    const stagedPath = `${TARGET_ENTRY_ID}/migration-${asset.sha256}.webp`;
    const result = await applyArchivedThumbnail({
      client,
      entryId: TARGET_ENTRY_ID,
      previousThumbnailPath,
      asset,
    });

    expect(result).toEqual({
      status: "failed",
      placeholderAssigned: true,
      cleanupFailed: false,
    });
    expect(calls.removals).toContainEqual([stagedPath]);
    expect(calls.removals).toContainEqual([previousThumbnailPath]);
    expect(calls.updates).toContainEqual({
      values: { thumbnail_path: null },
      column: "id",
      value: TARGET_ENTRY_ID,
    });
  });

  it("never removes a thumbnail path belonging to another entry", async () => {
    const asset = await archivedAsset();
    const { client, calls } = targetClient();
    const result = await applyArchivedThumbnail({
      client,
      entryId: TARGET_ENTRY_ID,
      previousThumbnailPath: "22222222-2222-4222-8222-222222222222/other.webp",
      asset,
    });

    expect(result).toMatchObject({ status: "succeeded", cleanupFailed: true });
    expect(calls.removals).toHaveLength(0);
  });
});
