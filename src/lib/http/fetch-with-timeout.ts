export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const THUMBNAIL_PREPARATION_TIMEOUT_MS = 30_000;
export const THUMBNAIL_UPLOAD_TIMEOUT_MS = 60_000;

type TimeoutOptions = {
  timeoutMs?: number;
  timeoutMessage?: string;
};

export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

function normalizedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("The request timeout must be a positive number.");
  }
  return timeoutMs;
}

/**
 * Bounds an arbitrary promise. This is useful for browser SDK operations that
 * do not expose an AbortSignal, such as a signed Supabase Storage upload.
 */
export async function withTimeout<T>(
  operation: PromiseLike<T>,
  {
    timeoutMs: requestedTimeoutMs,
    timeoutMessage = "The request took too long. Check your connection and try again.",
  }: TimeoutOptions = {},
): Promise<T> {
  const timeoutMs = normalizedTimeout(requestedTimeoutMs);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new RequestTimeoutError(timeoutMessage, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(operation), timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * Runs fetch with a deadline while preserving a caller-provided AbortSignal.
 * The internal request is aborted when the deadline expires, and the stable
 * RequestTimeoutError lets UI code show an operation-specific recovery message.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  {
    timeoutMs: requestedTimeoutMs,
    timeoutMessage = "The request took too long. Check your connection and try again.",
  }: TimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = normalizedTimeout(requestedTimeoutMs);
  const controller = new AbortController();
  const callerSignal = init.signal;
  let timedOut = false;

  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new RequestTimeoutError(timeoutMessage, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetch(input, { ...init, signal: controller.signal }), timeout]);
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError(timeoutMessage, timeoutMs);
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}
