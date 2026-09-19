import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_THUMBNAIL_INPUT_BYTES } from "@/lib/images/thumbnails";

const entryId = "00000000-0000-4000-8000-000000000101";
const otherEntryId = "00000000-0000-4000-8000-000000000102";
const userId = "00000000-0000-4000-8000-000000000103";
const uploadId = "00000000-0000-4000-8000-000000000104";
const uploadPath = `${entryId}/${uploadId}.upload`;
const otherUploadPath = `${otherEntryId}/${uploadId}.upload`;

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  createServiceRoleClient: vi.fn(),
  getThumbnailObjectPath: vi.fn(),
  getThumbnailUploadObjectPath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}));
vi.mock("@/lib/images/thumbnails", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/images/thumbnails")>();
  return {
    ...original,
    getThumbnailObjectPath: mocks.getThumbnailObjectPath,
    getThumbnailUploadObjectPath: mocks.getThumbnailUploadObjectPath,
  };
});

import { POST } from "@/app/api/v1/entries/[id]/thumbnail/route";

function request(body: unknown) {
  return new Request(`https://curio.example.test/api/v1/entries/${entryId}/thumbnail`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://curio.example.test",
    },
    body: JSON.stringify(body),
  });
}

function context() {
  return { params: Promise.resolve({ id: entryId }) };
}

function actorSupabase() {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: { id: entryId, created_by: userId, status: "ready" },
    error: null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq, maybeSingle };
}

function stagedFile(bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes);
  return {
    size: copy.byteLength,
    arrayBuffer: vi.fn().mockResolvedValue(copy.buffer),
  };
}

function storageBackend(
  options: {
    stagedFile?: { size: number; arrayBuffer: () => Promise<ArrayBuffer> };
    previousThumbnailPath?: string | null;
    replacementError?: Error | null;
    reconciledThumbnailPath?: string | null;
    reconciliationError?: Error | null;
    staleUploadNames?: string[];
  } = {},
) {
  const privateUpload = options.stagedFile ?? stagedFile(new Uint8Array([1, 2, 3]));
  const previousThumbnailPath = options.previousThumbnailPath ?? null;
  const signedUpload = vi.fn().mockResolvedValue({
    data: { token: "signed-upload-token" },
    error: null,
  });
  const download = vi.fn().mockResolvedValue({ data: privateUpload, error: null });
  const upload = vi.fn().mockResolvedValue({ data: { path: "stored" }, error: null });
  const signedUrl = vi.fn().mockResolvedValue({
    data: { signedUrl: "https://storage.example.test/signed-preview" },
    error: null,
  });
  const list = vi.fn().mockResolvedValue({
    data: (options.staleUploadNames ?? []).map((name) => ({
      name,
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    })),
    error: null,
  });
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  const remove = vi.fn(async (bucket: string, paths: string[]) => {
    removed.push({ bucket, paths });
    return { data: paths, error: null };
  });

  const buckets = new Map<string, unknown>();
  const storageFrom = vi.fn((bucket: string) => {
    if (buckets.has(bucket)) return buckets.get(bucket);
    const api = {
      createSignedUploadUrl: signedUpload,
      download,
      upload,
      createSignedUrl: signedUrl,
      list,
      remove: (paths: string[]) => remove(bucket, paths),
    };
    buckets.set(bucket, api);
    return api;
  });

  const replacement = {
    id: entryId,
    thumbnail_path: `${entryId}/new.webp`,
    previous_thumbnail_path: previousThumbnailPath,
  };
  const maybeSingle = vi.fn().mockResolvedValue({
    data: options.replacementError ? null : replacement,
    error: options.replacementError ?? null,
  });
  const reserve = vi.fn().mockResolvedValue({ data: true, error: null });
  const rpc = vi.fn((name: string) =>
    name === "reserve_thumbnail_upload" ? reserve() : { maybeSingle },
  );
  const currentMaybeSingle = vi.fn().mockResolvedValue({
    data:
      options.reconciledThumbnailPath === undefined
        ? null
        : { id: entryId, thumbnail_path: options.reconciledThumbnailPath },
    error: options.reconciliationError ?? null,
  });
  const currentEq = vi.fn(() => ({ maybeSingle: currentMaybeSingle }));
  const currentSelect = vi.fn(() => ({ eq: currentEq }));
  const from = vi.fn((table: string) => {
    if (table !== "entries") throw new Error(`Unexpected backend table ${table}`);
    return { select: currentSelect };
  });

  return {
    backend: { storage: { from: storageFrom }, rpc, from },
    signedUpload,
    download,
    upload,
    signedUrl,
    list,
    remove,
    removed,
    rpc,
    currentMaybeSingle,
  };
}

describe("POST /api/v1/entries/:id/thumbnail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const supabase = actorSupabase();
    mocks.authenticateRequest.mockResolvedValue({
      role: "contributor",
      user: { id: userId },
      supabase,
    });
    mocks.getThumbnailUploadObjectPath.mockReturnValue(uploadPath);
    mocks.getThumbnailObjectPath.mockReturnValue(`${entryId}/new.webp`);
  });

  it("preserves recent uploads and uploads without a reliable timestamp", async () => {
    const storage = storageBackend();
    storage.list.mockResolvedValue({
      data: [
        { name: `${uploadId}.upload`, created_at: new Date().toISOString() },
        { name: "00000000-0000-4000-8000-000000000105.upload", created_at: "" },
        { name: "00000000-0000-4000-8000-000000000106.upload", created_at: "invalid" },
      ],
      error: null,
    });
    mocks.createServiceRoleClient.mockReturnValue(storage.backend);
    const response = await POST(
      request({ action: "prepare", contentType: "image/png", fileSize: 1024 }),
      context(),
    );
    expect(response.status).toBe(201);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(storage.signedUpload).toHaveBeenCalled();
  });

  it("prepares a private signed upload with the validated content type and limit", async () => {
    const storage = storageBackend();
    mocks.createServiceRoleClient.mockReturnValue(storage.backend);

    const response = await POST(
      request({ action: "prepare", contentType: "image/png", fileSize: 1024 }),
      context(),
    );

    expect(response.status).toBe(201);
    expect(storage.rpc).toHaveBeenCalledWith("reserve_thumbnail_upload", {
      p_actor_user_id: userId,
      p_entry_id: entryId,
    });
    expect(storage.list).toHaveBeenCalledWith(entryId, {
      limit: 100,
      sortBy: { column: "created_at", order: "asc" },
    });
    expect(storage.signedUpload).toHaveBeenCalledWith(uploadPath, { upsert: false });
    expect(await response.json()).toEqual({
      data: {
        upload: {
          bucket: "thumbnail_uploads",
          path: uploadPath,
          token: "signed-upload-token",
          contentType: "image/png",
          maximumBytes: MAX_THUMBNAIL_INPUT_BYTES,
        },
      },
      error: null,
    });
  });

  it("removes abandoned uploads for the entry before issuing another signed URL", async () => {
    const staleId = "00000000-0000-4000-8000-000000000105";
    const storage = storageBackend({ staleUploadNames: [`${staleId}.upload`] });
    mocks.createServiceRoleClient.mockReturnValue(storage.backend);

    const response = await POST(
      request({ action: "prepare", contentType: "image/webp", fileSize: 1024 }),
      context(),
    );

    expect(response.status).toBe(201);
    expect(storage.removed).toEqual([
      { bucket: "thumbnail_uploads", paths: [`${entryId}/${staleId}.upload`] },
    ]);
    expect(storage.signedUpload).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "a declared file larger than 5 MiB",
      { action: "prepare", contentType: "image/png", fileSize: MAX_THUMBNAIL_INPUT_BYTES + 1 },
    ],
    [
      "an unknown payload field",
      { action: "prepare", contentType: "image/png", fileSize: 1024, administrator: true },
    ],
  ])("rejects %s before creating storage state", async (_label, body) => {
    const storage = storageBackend();
    mocks.createServiceRoleClient.mockReturnValue(storage.backend);

    const response = await POST(request(body), context());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(storage.signedUpload).not.toHaveBeenCalled();
  });

  it("rejects a staging path owned by another entry without downloading or deleting it", async () => {
    const storage = storageBackend();
    mocks.createServiceRoleClient.mockReturnValue(storage.backend);

    const response = await POST(
      request({ action: "finalize", uploadPath: otherUploadPath }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: "INVALID_UPLOAD_PATH" },
    });
    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("rejects an actual staging object larger than 5 MiB and removes it", async () => {
    const storage = storageBackend({
      stagedFile: {
        size: MAX_THUMBNAIL_INPUT_BYTES + 1,
        arrayBuffer: vi.fn(),
      },
    });
    mocks.createServiceRoleClient.mockReturnValue(storage.backend);

    const response = await POST(request({ action: "finalize", uploadPath }), context());

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: "IMAGE_TOO_LARGE" },
    });
    expect(storage.removed).toEqual([{ bucket: "thumbnail_uploads", paths: [uploadPath] }]);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("rejects falsified image bytes and always removes the private staging object", async () => {
    const storage = storageBackend({
      stagedFile: stagedFile(Buffer.from("not an image")),
    });
    mocks.createServiceRoleClient.mockReturnValue(storage.backend);

    const response = await POST(request({ action: "finalize", uploadPath }), context());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: "INVALID_IMAGE" },
    });
    expect(storage.removed).toEqual([{ bucket: "thumbnail_uploads", paths: [uploadPath] }]);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.rpc).not.toHaveBeenCalled();
  });

  it("stores and attaches a verified image, then removes the old and staging objects", async () => {
    const oldPath = `${entryId}/old.webp`;
    const source = await sharp({
      create: { width: 24, height: 24, channels: 3, background: "#0075c9" },
    })
      .png()
      .toBuffer();
    const storage = storageBackend({
      stagedFile: stagedFile(source),
      previousThumbnailPath: oldPath,
    });
    mocks.createServiceRoleClient.mockReturnValue(storage.backend);

    const response = await POST(request({ action: "finalize", uploadPath }), context());

    expect(storage.upload).toHaveBeenCalledWith(`${entryId}/new.webp`, expect.any(Buffer), {
      contentType: "image/webp",
      cacheControl: "31536000, immutable",
      upsert: false,
    });
    expect(storage.rpc).toHaveBeenCalledWith("replace_entry_thumbnail", {
      p_actor_user_id: userId,
      p_entry_id: entryId,
      p_thumbnail_path: `${entryId}/new.webp`,
    });
    expect(storage.removed).toEqual([
      { bucket: "thumbnails", paths: [oldPath] },
      { bucket: "thumbnail_uploads", paths: [uploadPath] },
    ]);
    expect(storage.signedUrl).toHaveBeenCalledWith(`${entryId}/new.webp`, 15 * 60);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        id: entryId,
        thumbnailUrl: "https://storage.example.test/signed-preview",
      },
      error: null,
    });
  });

  it("preserves an attached object when the RPC acknowledgement is lost after commit", async () => {
    const source = await sharp({
      create: { width: 24, height: 24, channels: 3, background: "#0075c9" },
    })
      .png()
      .toBuffer();
    const newPath = `${entryId}/new.webp`;
    const storage = storageBackend({
      stagedFile: stagedFile(source),
      replacementError: new Error("synthetic acknowledgement loss"),
      reconciledThumbnailPath: newPath,
    });
    mocks.createServiceRoleClient.mockReturnValue(storage.backend);

    const response = await POST(request({ action: "finalize", uploadPath }), context());

    expect(storage.currentMaybeSingle).toHaveBeenCalledOnce();
    expect(storage.removed).toEqual([{ bucket: "thumbnail_uploads", paths: [uploadPath] }]);
    expect(storage.signedUrl).toHaveBeenCalledWith(newPath, 15 * 60);
    expect(response.status).toBe(200);
  });

  it("keeps the final object when attachment state cannot be reconciled", async () => {
    const source = await sharp({
      create: { width: 24, height: 24, channels: 3, background: "#0075c9" },
    })
      .png()
      .toBuffer();
    const storage = storageBackend({
      stagedFile: stagedFile(source),
      replacementError: new Error("synthetic acknowledgement loss"),
      reconciliationError: new Error("synthetic reconciliation outage"),
    });
    mocks.createServiceRoleClient.mockReturnValue(storage.backend);

    const response = await POST(request({ action: "finalize", uploadPath }), context());

    expect(storage.removed).toEqual([{ bucket: "thumbnail_uploads", paths: [uploadPath] }]);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "THUMBNAIL_RECONCILIATION_REQUIRED" },
    });
  });
});
