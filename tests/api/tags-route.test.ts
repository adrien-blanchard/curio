import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubValidAuthEnvironment } from "../auth/test-environment";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const extensionOrigin = `chrome-extension://${extensionId}`;

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));

import { GET } from "@/app/api/v1/tags/route";

const tags = [
  {
    id: "00000000-0000-4000-8000-000000000311",
    name: "Accessibility",
    slug: "accessibility",
    color: "#2563EB",
  },
];

function request() {
  return new Request("https://curio.example.test/api/v1/tags", {
    headers: { Origin: extensionOrigin },
  });
}

function cookieTagClient(result: { data: unknown; error: unknown }) {
  const secondOrder = vi.fn().mockResolvedValue(result);
  const firstOrder = vi.fn(() => ({ order: secondOrder }));
  const select = vi.fn(() => ({ order: firstOrder }));
  const from = vi.fn(() => ({ select }));
  return { client: { from }, from, select, firstOrder, secondOrder };
}

describe("GET /api/v1/tags", () => {
  beforeEach(() => {
    stubValidAuthEnvironment({
      EXTENSION_ENABLED: "true",
      ALLOWED_EXTENSION_IDS: extensionId,
    });
    mocks.authenticateRequest.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("loads ordered tags through the authenticated browser client", async () => {
    const database = cookieTagClient({ data: tags, error: null });
    mocks.authenticateRequest.mockResolvedValue({
      mode: "cookie",
      tokenHash: null,
      supabase: database.client,
    });

    const response = await GET(request());

    expect(mocks.authenticateRequest).toHaveBeenCalledWith(expect.any(Request), {
      scopes: ["tags:read"],
    });
    expect(database.from).toHaveBeenCalledWith("tags");
    expect(database.select).toHaveBeenCalledWith("id, name, slug, color");
    expect(database.firstOrder).toHaveBeenCalledWith("sort_order", { ascending: true });
    expect(database.secondOrder).toHaveBeenCalledWith("name", { ascending: true });
    expect(response.headers.get("access-control-allow-origin")).toBe(extensionOrigin);
    expect(await response.json()).toEqual({ data: { tags }, error: null });
  });

  it("uses the token-scoped RPC for a personal access token", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: tags, error: null });
    mocks.authenticateRequest.mockResolvedValue({
      mode: "api_token",
      tokenHash: "a".repeat(64),
      supabase: { rpc },
    });

    const response = await GET(request());

    expect(rpc).toHaveBeenCalledWith("get_tags_with_token", {
      p_token_hash: "a".repeat(64),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { tags }, error: null });
  });

  it("returns a stable error envelope when taxonomy loading fails", async () => {
    const database = cookieTagClient({ data: null, error: { message: "unavailable" } });
    mocks.authenticateRequest.mockResolvedValue({
      mode: "cookie",
      tokenHash: null,
      supabase: database.client,
    });

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(response.headers.get("access-control-allow-origin")).toBe(extensionOrigin);
    expect(await response.json()).toEqual({
      data: null,
      error: { code: "TAGS_READ_FAILED", message: "Unable to load tags" },
    });
  });
});
