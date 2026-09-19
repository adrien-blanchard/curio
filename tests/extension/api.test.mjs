import { describe, expect, it, vi } from "vitest";
import {
  CurioApi,
  CurioApiError,
  MAX_RESPONSE_BODY_BYTES,
  profileLabel,
  tagsFromResponse,
} from "../../extension/lib/api.mjs";
import { REQUIRED_SCOPES } from "../../extension/lib/config.mjs";

const TOKEN = `curio_pat_${"test".repeat(8)}`;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Curio API client", () => {
  it("calls profile and tags endpoints with a Bearer token and no credentials", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            user: {
              id: "u1",
              email: "contributor@example.test",
              role: "contributor",
            },
            scopes: REQUIRED_SCOPES,
          },
          error: null,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { tags: [] }, error: null }));
    const api = new CurioApi({
      instanceUrl: "https://curio.example.test",
      token: TOKEN,
      fetchImpl,
    });

    await api.getProfile();
    await api.getTags();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0].href).toBe("https://curio.example.test/api/v1/me");
    expect(fetchImpl.mock.calls[1][0].href).toBe("https://curio.example.test/api/v1/tags");
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.credentials).toBe("omit");
      expect(init.redirect).toBe("error");
      expect(init.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("uses the exact entries API payload", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { id: "entry-1", status: "processing" }, error: null }, 202),
      );
    const api = new CurioApi({
      instanceUrl: "https://curio.example.test",
      token: TOKEN,
      fetchImpl,
    });

    await api.createEntry({
      url: "https://article.example.test/item",
      sourceType: "opensource",
      tagIds: ["tag-1", "tag-2"],
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.href).toBe("https://curio.example.test/api/v1/entries");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      url: "https://article.example.test/item",
      sourceType: "opensource",
      tagIds: ["tag-1", "tag-2"],
    });
  });

  it("normalizes the documented tags and profile envelopes", () => {
    const tags = tagsFromResponse({
      data: {
        tags: [
          { id: "2", name: "Video", slug: "video", color: "#000000" },
          { id: "1", name: "AI", slug: "ai", color: "#ffffff" },
        ],
      },
      error: null,
    });
    expect(tags).toEqual([
      { id: "1", name: "AI" },
      { id: "2", name: "Video" },
    ]);
    expect(
      profileLabel({ data: { user: { email: "reader@example.test" }, scopes: REQUIRED_SCOPES } }),
    ).toBe("reader@example.test");
  });

  it("maps authentication errors without exposing an arbitrary server body", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "sensitive backend detail" }, 401));
    const api = new CurioApi({
      instanceUrl: "https://curio.example.test",
      token: TOKEN,
      fetchImpl,
    });
    await expect(api.getProfile()).rejects.toMatchObject({
      name: "CurioApiError",
      status: 401,
      message: "The connection key is invalid or has been revoked.",
    });
  });

  it("rejects invalid API paths before fetching", async () => {
    const fetchImpl = vi.fn();
    const api = new CurioApi({
      instanceUrl: "https://curio.example.test",
      token: TOKEN,
      fetchImpl,
    });
    await expect(api.request("https://attacker.example.test/")).rejects.toBeInstanceOf(TypeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports invalid successful responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not-json", { status: 200 }));
    const api = new CurioApi({
      instanceUrl: "https://curio.example.test",
      token: TOKEN,
      fetchImpl,
    });
    await expect(api.getProfile()).rejects.toBeInstanceOf(CurioApiError);
  });

  it("keeps the timeout active while a response body is stalled", async () => {
    const stalledBody = new ReadableStream({ start() {} });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(stalledBody, { status: 200 }));
    const api = new CurioApi({
      instanceUrl: "https://curio.example.test",
      token: TOKEN,
      fetchImpl,
      timeoutMs: 20,
    });

    await expect(api.getProfile()).rejects.toMatchObject({
      name: "CurioApiError",
      code: "timeout",
      message: "The Curio request timed out.",
    });
  });

  it("rejects a chunked JSON response before buffering more than the byte limit", async () => {
    const oversizedBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_RESPONSE_BODY_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(oversizedBody, { status: 200 }));
    const api = new CurioApi({
      instanceUrl: "https://curio.example.test",
      token: TOKEN,
      fetchImpl,
    });

    await expect(api.getProfile()).rejects.toMatchObject({
      name: "CurioApiError",
      code: "response_too_large",
      message: "Curio returned a response that is too large.",
    });
  });
});
