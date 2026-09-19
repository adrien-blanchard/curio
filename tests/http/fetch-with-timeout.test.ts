import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWithTimeout, RequestTimeoutError, withTimeout } from "@/lib/http/fetch-with-timeout";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts the request and rejects with the configured message at the deadline", async () => {
    vi.useFakeTimers();
    const abortObserved = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              abortObserved();
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
      }),
    );

    const request = fetchWithTimeout(
      "/slow",
      {},
      { timeoutMs: 1_000, timeoutMessage: "The save timed out." },
    );
    const rejection = expect(request).rejects.toMatchObject({
      name: "RequestTimeoutError",
      message: "The save timed out.",
      timeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(abortObserved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(abortObserved).toHaveBeenCalledOnce();
  });

  it("preserves a caller abort instead of reporting a timeout", async () => {
    const caller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }),
    );

    const request = fetchWithTimeout("/cancelled", { signal: caller.signal });
    caller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("bounds SDK operations that do not accept an AbortSignal", async () => {
    vi.useFakeTimers();
    const operation = new Promise<never>(() => undefined);
    const result = withTimeout(operation, {
      timeoutMs: 60_000,
      timeoutMessage: "Uploading took too long.",
    });
    const rejection = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);

    await vi.advanceTimersByTimeAsync(60_000);

    await rejection;
  });
});
