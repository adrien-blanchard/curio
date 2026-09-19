import { normalizeInstanceUrl, normalizePersonalToken } from "./config.mjs";

const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_RESPONSE_BODY_BYTES = 1_048_576;

export class CurioApiError extends Error {
  constructor(message, { status = 0, code = "request_failed", cause } = {}) {
    super(message, { cause });
    this.name = "CurioApiError";
    this.status = status;
    this.code = code;
  }
}

function errorMessageForStatus(status, payload) {
  const remoteMessage = [payload?.message, payload?.error?.message, payload?.error]
    .find((value) => typeof value === "string" && value.trim())
    ?.trim();

  if (status === 401) return "The connection key is invalid or has been revoked.";
  if (status === 403) return "Create a new browser connection key in Curio and try again.";
  if (status === 400 || status === 409 || status === 422) {
    return remoteMessage?.slice(0, 240) || "Curio rejected this page.";
  }
  if (status === 429) return "Curio is receiving too many requests. Try again shortly.";
  if (status >= 500) return "The Curio instance is temporarily unavailable.";
  return remoteMessage?.slice(0, 240) || `Curio returned HTTP ${status}.`;
}

function responseTooLargeError(status) {
  return new CurioApiError("Curio returned a response that is too large.", {
    status,
    code: "response_too_large",
  });
}

function abortReason(signal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

async function readChunk(reader, signal) {
  if (signal.aborted) throw abortReason(signal);

  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([reader.read(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function readBoundedResponseText(response, signal) {
  const declaredLength = response.headers.get("Content-Length");
  if (/^[0-9]+$/u.test(declaredLength ?? "") && Number(declaredLength) > MAX_RESPONSE_BODY_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw responseTooLargeError(response.status);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await readChunk(reader, signal);
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BODY_BYTES) {
        await reader.cancel("Response body limit exceeded.");
        throw responseTooLargeError(response.status);
      }
      chunks.push(value);
    }
  } catch (cause) {
    if (signal.aborted) {
      await reader.cancel(signal.reason).catch(() => undefined);
    }
    throw cause;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function parseResponseBody(response, signal) {
  if (response.status === 204) return null;
  const text = await readBoundedResponseText(response, signal);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    if (response.ok) {
      throw new CurioApiError("Curio returned an invalid response.", {
        status: response.status,
        code: "invalid_response",
      });
    }
    return null;
  }
}

export class CurioApi {
  constructor({
    instanceUrl,
    token,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }) {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("A fetch implementation is required.");
    }
    this.instanceUrl = normalizeInstanceUrl(instanceUrl);
    this.token = normalizePersonalToken(token);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(pathname, { method = "GET", body } = {}) {
    if (!/^\/api\/v1\/[a-z0-9/-]+$/u.test(pathname)) {
      throw new TypeError("Invalid Curio API path.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
    });
    if (body !== undefined) headers.set("Content-Type", "application/json");

    let response;
    let payload;
    try {
      response = await this.fetchImpl(new URL(pathname, this.instanceUrl), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      payload = await parseResponseBody(response, controller.signal);
    } catch (cause) {
      if (cause instanceof CurioApiError) throw cause;
      const timedOut = controller.signal.aborted;
      throw new CurioApiError(
        timedOut ? "The Curio request timed out." : "Could not reach the Curio instance.",
        { code: timedOut ? "timeout" : "network_error", cause },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new CurioApiError(errorMessageForStatus(response.status, payload), {
        status: response.status,
        code: "http_error",
      });
    }
    return payload;
  }

  getProfile() {
    return this.request("/api/v1/me");
  }

  getTags() {
    return this.request("/api/v1/tags");
  }

  createEntry({ url, sourceType, tagIds }) {
    return this.request("/api/v1/entries", {
      method: "POST",
      body: {
        url,
        sourceType,
        tagIds,
      },
    });
  }
}

export function tagsFromResponse(payload) {
  const candidate = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.tags)
      ? payload.tags
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.data?.tags)
          ? payload.data.tags
          : [];

  return candidate
    .filter(
      (tag) =>
        tag &&
        (typeof tag.id === "string" || typeof tag.id === "number") &&
        typeof tag.name === "string",
    )
    .map((tag) => ({ id: String(tag.id), name: tag.name.trim() }))
    .filter((tag) => tag.name)
    .sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }));
}

export function profileLabel(payload) {
  const profile = payload?.data?.user ?? payload?.user ?? payload?.data ?? payload ?? {};
  return (
    [profile.display_name, profile.name, profile.email]
      .find((value) => typeof value === "string" && value.trim())
      ?.trim() || "Connected account"
  );
}
