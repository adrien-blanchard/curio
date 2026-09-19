import "server-only";

import { randomUUID } from "node:crypto";

import sharp, { type Metadata } from "sharp";

import { canonicalizeUrl, getYouTubeVideoId } from "@/lib/security/public-url-core";

export { getWorkflowThumbnailObjectPath } from "./workflow-thumbnail-path";

export const THUMBNAIL_WIDTH = 720;
export const THUMBNAIL_HEIGHT = 309;
export const THUMBNAIL_CONTENT_TYPE = "image/webp";
export const MAX_THUMBNAIL_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_THUMBNAIL_DIMENSION = 8_192;
export const MAX_THUMBNAIL_PIXELS = 40_000_000;
export const TRUSTED_THUMBNAIL_MAX_ATTEMPTS = 2;
export const TRUSTED_THUMBNAIL_RETRY_DELAY_MS = 300;

const TRUSTED_REMOTE_IMAGE_HOSTS = new Set(["i.ytimg.com", "opengraph.githubassets.com"]);
const MICROLINK_PUBLIC_ORIGIN = "https://api.microlink.io";
const MICROLINK_PRO_ORIGIN = "https://pro.microlink.io";
const ALLOWED_INPUT_FORMATS = new Set(["jpeg", "png", "webp"]);

export type ThumbnailErrorCode =
  | "IMAGE_TOO_LARGE"
  | "INVALID_IMAGE"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "UNTRUSTED_IMAGE_HOST"
  | "IMAGE_REDIRECT_NOT_ALLOWED"
  | "IMAGE_DOWNLOAD_TIMEOUT"
  | "IMAGE_DOWNLOAD_FAILED";

export type TrustedThumbnailProvider = "youtube" | "github";

export type TrustedThumbnailSelection = {
  provider: TrustedThumbnailProvider;
  url: string;
};

export type ThumbnailDownloadResult =
  | {
      ok: true;
      thumbnail: OptimizedThumbnail;
      attempts: number;
    }
  | {
      ok: false;
      code: ThumbnailErrorCode;
      attempts: number;
    };

export type MicrolinkPreviewRequest = {
  url: string;
  headers: Readonly<Record<string, string>>;
};

type ThumbnailErrorOptions = ErrorOptions & { retryable?: boolean };

export class ThumbnailError extends Error {
  constructor(
    readonly code: ThumbnailErrorCode,
    message: string,
    options: ThumbnailErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ThumbnailError";
    this.retryable = options.retryable ?? false;
  }

  readonly retryable: boolean;
}

export type OptimizedThumbnail = {
  buffer: Buffer;
  contentType: typeof THUMBNAIL_CONTENT_TYPE;
  extension: "webp";
  width: typeof THUMBNAIL_WIDTH;
  height: typeof THUMBNAIL_HEIGHT;
};

async function validateImage(input: Buffer): Promise<void> {
  if (input.byteLength === 0) {
    throw new ThumbnailError("INVALID_IMAGE", "The image file is empty.");
  }
  if (input.byteLength > MAX_THUMBNAIL_INPUT_BYTES) {
    throw new ThumbnailError("IMAGE_TOO_LARGE", "The image exceeds the 5 MiB upload limit.");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input, {
      animated: false,
      failOn: "warning",
      limitInputPixels: MAX_THUMBNAIL_PIXELS,
    }).metadata();
  } catch (error) {
    throw new ThumbnailError("INVALID_IMAGE", "The file is not a safe, readable image.", {
      cause: error,
    });
  }

  if (!metadata.format || !ALLOWED_INPUT_FORMATS.has(metadata.format)) {
    throw new ThumbnailError(
      "UNSUPPORTED_IMAGE_TYPE",
      "Only JPEG, PNG and WebP images are supported.",
    );
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > MAX_THUMBNAIL_DIMENSION ||
    metadata.height > MAX_THUMBNAIL_DIMENSION ||
    metadata.width * metadata.height > MAX_THUMBNAIL_PIXELS ||
    (metadata.pages ?? 1) > 1
  ) {
    throw new ThumbnailError(
      "INVALID_IMAGE",
      "The image dimensions or frame count are not supported.",
    );
  }
}

export async function createThumbnailWebp(input: Buffer): Promise<OptimizedThumbnail> {
  await validateImage(input);
  const buffer = await sharp(input, {
    animated: false,
    failOn: "warning",
    limitInputPixels: MAX_THUMBNAIL_PIXELS,
  })
    .rotate()
    .resize({
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      fit: "cover",
      position: sharp.strategy.attention,
    })
    .webp({ quality: 76, effort: 5, smartSubsample: true })
    .toBuffer();

  return {
    buffer,
    contentType: THUMBNAIL_CONTENT_TYPE,
    extension: "webp",
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
  };
}

export async function createPlaceholderThumbnail(): Promise<OptimizedThumbnail> {
  const svg = Buffer.from(`
    <svg width="720" height="309" viewBox="0 0 720 309" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#e8f4fc"/>
          <stop offset="1" stop-color="#f4f7fe"/>
        </linearGradient>
      </defs>
      <rect width="720" height="309" fill="url(#background)"/>
      <circle cx="360" cy="154.5" r="58" fill="#0075c9" opacity="0.10"/>
      <circle cx="360" cy="154.5" r="32" fill="none" stroke="#0075c9" stroke-width="12"/>
      <circle cx="382" cy="132" r="8" fill="#f4f7fe"/>
    </svg>
  `);
  const buffer = await sharp(svg).webp({ quality: 82, effort: 5, smartSubsample: true }).toBuffer();
  return {
    buffer,
    contentType: THUMBNAIL_CONTENT_TYPE,
    extension: "webp",
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
  };
}

export function getThumbnailObjectPath(entryId: string): string {
  return `${entryId}/${randomUUID()}.webp`;
}

export function getThumbnailUploadObjectPath(entryId: string): string {
  return `${entryId}/${randomUUID()}.upload`;
}

export function selectTrustedThumbnail(resourceUrl: string): TrustedThumbnailSelection | null {
  let url: URL;
  try {
    url = new URL(resourceUrl);
  } catch {
    return null;
  }
  const youtubeId = getYouTubeVideoId(url);
  if (youtubeId) {
    return {
      provider: "youtube",
      url: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    };
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== "github.com" && hostname !== "www.github.com") return null;
  const [owner, repository] = url.pathname.split("/").filter(Boolean);
  if (
    !owner ||
    !repository ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(owner) ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(repository)
  ) {
    return null;
  }
  return {
    provider: "github",
    url: `https://opengraph.githubassets.com/1/${owner}/${repository}`,
  };
}

/** Compatibility wrapper for callers that only need the selected URL. */
export function selectTrustedThumbnailUrl(resourceUrl: string): string | null {
  return selectTrustedThumbnail(resourceUrl)?.url ?? null;
}

async function readLimitedBody(response: Response): Promise<Buffer> {
  if (!response.body) {
    throw new ThumbnailError("IMAGE_DOWNLOAD_FAILED", "The image response was empty.");
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_THUMBNAIL_INPUT_BYTES) {
    throw new ThumbnailError("IMAGE_TOO_LARGE", "The remote image exceeds 5 MiB.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_THUMBNAIL_INPUT_BYTES) {
      await reader.cancel();
      throw new ThumbnailError("IMAGE_TOO_LARGE", "The remote image exceeds 5 MiB.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function fetchRemoteThumbnail(
  url: URL,
  fetcher: typeof fetch,
  headers: Readonly<Record<string, string>>,
): Promise<OptimizedThumbnail> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers,
    });
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ThumbnailError(
      timedOut ? "IMAGE_DOWNLOAD_TIMEOUT" : "IMAGE_DOWNLOAD_FAILED",
      timedOut
        ? "The trusted thumbnail download timed out."
        : "The trusted thumbnail could not be downloaded.",
      { cause: error, retryable: true },
    );
  }
  if (response.status >= 300 && response.status < 400) {
    throw new ThumbnailError(
      "IMAGE_REDIRECT_NOT_ALLOWED",
      "Remote image redirects are not allowed.",
    );
  }
  if (!response.ok) {
    throw new ThumbnailError(
      "IMAGE_DOWNLOAD_FAILED",
      "The trusted thumbnail host returned an error.",
      {
        retryable:
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500,
      },
    );
  }

  return createThumbnailWebp(await readLimitedBody(response));
}

export async function downloadTrustedThumbnail(
  input: string,
  fetcher: typeof fetch = fetch,
): Promise<OptimizedThumbnail> {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !TRUSTED_REMOTE_IMAGE_HOSTS.has(url.hostname.toLowerCase())
  ) {
    throw new ThumbnailError("UNTRUSTED_IMAGE_HOST", "The remote image host is not allowlisted.");
  }

  return fetchRemoteThumbnail(url, fetcher, {
    Accept: "image/webp,image/png,image/jpeg",
  });
}

export function createMicrolinkPreviewRequest(
  resourceUrl: string,
  apiKey?: string,
): MicrolinkPreviewRequest {
  const canonicalUrl = canonicalizeUrl(resourceUrl);
  const normalizedApiKey = apiKey?.trim();
  const endpoint = new URL(normalizedApiKey ? MICROLINK_PRO_ORIGIN : MICROLINK_PUBLIC_ORIGIN);
  endpoint.searchParams.set("url", canonicalUrl);
  endpoint.searchParams.set("embed", "image.url");
  endpoint.searchParams.set("prerender", "false");
  endpoint.searchParams.set("retry", "0");
  return {
    url: endpoint.toString(),
    headers: {
      Accept: "image/webp,image/png,image/jpeg",
      ...(normalizedApiKey ? { "x-api-key": normalizedApiKey } : {}),
    },
  };
}

export type MicrolinkDownloadOptions = {
  apiKey?: string;
  fetcher?: typeof fetch;
};

export async function downloadMicrolinkThumbnail(
  resourceUrl: string,
  options: MicrolinkDownloadOptions = {},
): Promise<OptimizedThumbnail> {
  const request = createMicrolinkPreviewRequest(resourceUrl, options.apiKey);
  const endpoint = new URL(request.url);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    (endpoint.hostname !== "api.microlink.io" && endpoint.hostname !== "pro.microlink.io")
  ) {
    throw new ThumbnailError("UNTRUSTED_IMAGE_HOST", "The preview provider is not allowlisted.");
  }
  return fetchRemoteThumbnail(endpoint, options.fetcher ?? fetch, request.headers);
}

function thumbnailFailure(error: unknown): Pick<ThumbnailError, "code" | "retryable"> {
  if (error instanceof ThumbnailError) return error;
  return { code: "IMAGE_DOWNLOAD_FAILED", retryable: true };
}

/** Microlink is attempted once so a preview cannot unexpectedly consume quota. */
export async function downloadMicrolinkThumbnailOnce(
  resourceUrl: string,
  options: MicrolinkDownloadOptions = {},
): Promise<ThumbnailDownloadResult> {
  try {
    return {
      ok: true,
      thumbnail: await downloadMicrolinkThumbnail(resourceUrl, options),
      attempts: 1,
    };
  } catch (error) {
    return { ok: false, code: thumbnailFailure(error).code, attempts: 1 };
  }
}

type ThumbnailRetryOptions = {
  fetcher?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
};

/**
 * Makes one bounded retry for a transient trusted-host failure and always
 * returns a safe result. Optional preview failures must not fail an entry.
 */
export async function downloadTrustedThumbnailWithRetry(
  input: string,
  options: ThumbnailRetryOptions = {},
): Promise<ThumbnailDownloadResult> {
  const fetcher = options.fetcher ?? fetch;
  const sleep =
    options.sleep ??
    ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 1; attempt <= TRUSTED_THUMBNAIL_MAX_ATTEMPTS; attempt += 1) {
    try {
      return {
        ok: true,
        thumbnail: await downloadTrustedThumbnail(input, fetcher),
        attempts: attempt,
      };
    } catch (error) {
      const failure = thumbnailFailure(error);
      if (!failure.retryable || attempt === TRUSTED_THUMBNAIL_MAX_ATTEMPTS) {
        return { ok: false, code: failure.code, attempts: attempt };
      }
      try {
        await sleep(TRUSTED_THUMBNAIL_RETRY_DELAY_MS);
      } catch {
        return { ok: false, code: failure.code, attempts: attempt };
      }
    }
  }

  return {
    ok: false,
    code: "IMAGE_DOWNLOAD_FAILED",
    attempts: TRUSTED_THUMBNAIL_MAX_ATTEMPTS,
  };
}
