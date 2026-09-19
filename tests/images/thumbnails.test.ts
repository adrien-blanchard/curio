import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_THUMBNAIL_INPUT_BYTES,
  TRUSTED_THUMBNAIL_RETRY_DELAY_MS,
  ThumbnailError,
  createMicrolinkPreviewRequest,
  createThumbnailWebp,
  downloadMicrolinkThumbnail,
  downloadMicrolinkThumbnailOnce,
  downloadTrustedThumbnail,
  downloadTrustedThumbnailWithRetry,
  getWorkflowThumbnailObjectPath,
  selectTrustedThumbnail,
  selectTrustedThumbnailUrl,
} from "@/lib/images/thumbnails";

describe("thumbnail processing", () => {
  it("validates actual bytes and produces a fixed WebP", async () => {
    const source = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "#0075c9" },
    })
      .png()
      .toBuffer();
    const result = await createThumbnailWebp(source);
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 720, height: 309 });
  });

  it("rejects a falsified image", async () => {
    await expect(createThumbnailWebp(Buffer.from("not an image"))).rejects.toBeInstanceOf(
      ThumbnailError,
    );
  });

  it("selects only explicit YouTube and GitHub image hosts", () => {
    expect(selectTrustedThumbnail("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
    expect(selectTrustedThumbnail("https://github.com/example/project/tree/main")).toEqual({
      provider: "github",
      url: "https://opengraph.githubassets.com/1/example/project",
    });
    expect(selectTrustedThumbnailUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
    expect(selectTrustedThumbnailUrl("https://github.com/example/project")).toBe(
      "https://opengraph.githubassets.com/1/example/project",
    );
    expect(selectTrustedThumbnailUrl("https://example.com/article")).toBeNull();
  });

  it("uses a stable object path when a workflow step is replayed", () => {
    expect(getWorkflowThumbnailObjectPath("entry-id", "attempt-id")).toBe(
      "entry-id/workflow-attempt-id.webp",
    );
  });

  it("builds canonical public and authenticated Microlink requests", () => {
    const publicRequest = createMicrolinkPreviewRequest(
      "https://example.com/article?utm_source=curio&version=2#details",
    );
    const publicUrl = new URL(publicRequest.url);
    expect(publicUrl.origin).toBe("https://api.microlink.io");
    expect(publicUrl.searchParams.get("url")).toBe("https://example.com/article?version=2");
    expect(publicUrl.searchParams.get("embed")).toBe("image.url");
    expect(publicUrl.searchParams.get("prerender")).toBe("false");
    expect(publicUrl.searchParams.get("retry")).toBe("0");
    expect(publicRequest.headers).not.toHaveProperty("x-api-key");

    const proRequest = createMicrolinkPreviewRequest(
      "https://example.com/article",
      " synthetic-microlink-key ",
    );
    expect(new URL(proRequest.url).origin).toBe("https://pro.microlink.io");
    expect(proRequest.headers).toMatchObject({ "x-api-key": "synthetic-microlink-key" });
    expect(proRequest.url).not.toContain("synthetic-microlink-key");
    expect(() => createMicrolinkPreviewRequest("http://127.0.0.1/private")).toThrow();
    expect(() =>
      createMicrolinkPreviewRequest("https://user:password@example.com/private"),
    ).toThrow();
  });

  it("downloads embedded Microlink image bytes with one fixed-host request", async () => {
    const source = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#82c91e" },
    })
      .png()
      .toBuffer();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Uint8Array(source), { status: 200 }));

    const result = await downloadMicrolinkThumbnail("https://example.com/article", {
      apiKey: "synthetic-microlink-key",
      fetcher,
    });

    expect(result.contentType).toBe("image/webp");
    expect(fetcher).toHaveBeenCalledOnce();
    const [requestUrl, requestInit] = fetcher.mock.calls[0];
    expect(new URL(String(requestUrl)).origin).toBe("https://pro.microlink.io");
    expect(requestInit).toMatchObject({
      method: "GET",
      redirect: "manual",
      headers: expect.objectContaining({ "x-api-key": "synthetic-microlink-key" }),
    });
  });

  it("never retries a failed Microlink request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      downloadMicrolinkThumbnailOnce("https://example.com/article", { fetcher }),
    ).resolves.toEqual({ ok: false, code: "IMAGE_DOWNLOAD_FAILED", attempts: 1 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects redirects and oversized trusted responses", async () => {
    const redirect = async () => new Response(null, { status: 302 });
    await expect(
      downloadTrustedThumbnail("https://i.ytimg.com/vi/id/hqdefault.jpg", redirect),
    ).rejects.toMatchObject({ code: "IMAGE_REDIRECT_NOT_ALLOWED" });

    const oversized = async () =>
      new Response(new Uint8Array(1), {
        headers: { "content-length": String(MAX_THUMBNAIL_INPUT_BYTES + 1) },
      });
    await expect(
      downloadTrustedThumbnail("https://i.ytimg.com/vi/id/hqdefault.jpg", oversized),
    ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });

  it("makes one bounded retry for a transient trusted-host response", async () => {
    const source = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#0075c9" },
    })
      .png()
      .toBuffer();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(source), { status: 200 }));
    const sleep = vi.fn(async () => undefined);

    const result = await downloadTrustedThumbnailWithRetry(
      "https://opengraph.githubassets.com/1/example/project",
      { fetcher, sleep },
    );

    expect(result).toMatchObject({ ok: true, attempts: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(TRUSTED_THUMBNAIL_RETRY_DELAY_MS);
  });

  it("returns a safe failure after the bounded retry is exhausted", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      downloadTrustedThumbnailWithRetry("https://opengraph.githubassets.com/1/example/project", {
        fetcher,
        sleep: async () => undefined,
      }),
    ).resolves.toEqual({ ok: false, code: "IMAGE_DOWNLOAD_FAILED", attempts: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry a redirect or accept a lookalike trusted host", async () => {
    const redirect = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302 }));
    await expect(
      downloadTrustedThumbnailWithRetry("https://opengraph.githubassets.com/1/example/project", {
        fetcher: redirect,
      }),
    ).resolves.toEqual({ ok: false, code: "IMAGE_REDIRECT_NOT_ALLOWED", attempts: 1 });
    expect(redirect).toHaveBeenCalledOnce();

    const shouldNotRun = vi.fn<typeof fetch>();
    await expect(
      downloadTrustedThumbnail(
        "https://opengraph.githubassets.com.attacker.example/1/example/project",
        shouldNotRun,
      ),
    ).rejects.toMatchObject({ code: "UNTRUSTED_IMAGE_HOST" });
    expect(shouldNotRun).not.toHaveBeenCalled();
  });
});
