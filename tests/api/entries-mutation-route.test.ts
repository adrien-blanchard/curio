import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const entryId = "00000000-0000-4000-8000-000000000321";
const userId = "00000000-0000-4000-8000-000000000322";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}));

import { DELETE, PATCH } from "@/app/api/v1/entries/[id]/route";

function context(id = entryId) {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown) {
  return new Request(`https://curio.example.test/api/v1/entries/${entryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: "https://curio.example.test" },
    body: JSON.stringify(body),
  });
}

function deleteRequest() {
  return new Request(`https://curio.example.test/api/v1/entries/${entryId}`, {
    method: "DELETE",
    headers: { Origin: "https://curio.example.test" },
  });
}

function actorWithRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    actor: { user: { id: userId }, supabase: { rpc } },
    rpc,
  };
}

describe("PATCH /api/v1/entries/:id", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates, normalizes, and updates an entry through the actor-scoped RPC", async () => {
    const tagId = "00000000-0000-4000-8000-000000000323";
    const { actor, rpc } = actorWithRpc({
      data: [
        {
          id: entryId,
          title: "Updated title",
          tldr: "A sufficiently detailed updated summary for the knowledge base.",
          source_type: "proprietary",
          status: "ready",
        },
      ],
      error: null,
    });
    mocks.authenticateRequest.mockResolvedValue(actor);

    const response = await PATCH(
      patchRequest({
        title: "  Updated title  ",
        tldr: "  A sufficiently detailed updated summary for the knowledge base.  ",
        sourceType: "proprietary",
        tagIds: [tagId, tagId],
      }),
      context(),
    );

    expect(mocks.authenticateRequest).toHaveBeenCalledWith(expect.any(Request), {
      roles: ["contributor", "administrator"],
      allowApiToken: false,
      requireCsrf: true,
    });
    expect(rpc).toHaveBeenCalledWith("update_entry", {
      p_actor_user_id: userId,
      p_entry_id: entryId,
      p_title: "Updated title",
      p_tldr: "A sufficiently detailed updated summary for the knowledge base.",
      p_source_type: "proprietary",
      p_tag_ids: [tagId],
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: {
        id: entryId,
        title: "Updated title",
        tldr: "A sufficiently detailed updated summary for the knowledge base.",
        sourceType: "proprietary",
        status: "ready",
      },
      error: null,
    });
  });

  it.each([
    ["a future source date", { sourcePublishedAt: "2999-01-01", sourceDateKind: "published" }],
    ["a non-existent date", { sourcePublishedAt: "2026-02-30", sourceDateKind: "published" }],
    ["an unpaired date", { sourcePublishedAt: "2026-01-01" }],
    ["an unpaired clear", { sourcePublishedAt: null, sourceDateKind: "published" }],
    ["an empty update", {}],
    ["an unknown field", { title: "Valid title", administrator: true }],
    ["a malformed tag ID", { tagIds: ["not-a-uuid"] }],
    [
      "more than ten tags",
      {
        tagIds: Array.from(
          { length: 11 },
          (_, index) => `00000000-0000-4000-8000-${String(index + 400).padStart(12, "0")}`,
        ),
      },
    ],
  ])("rejects %s before calling the update RPC", async (_label, body) => {
    const { actor, rpc } = actorWithRpc({ data: null, error: null });
    mocks.authenticateRequest.mockResolvedValue(actor);

    const response = await PATCH(patchRequest(body), context());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed path UUID before authentication", async () => {
    const response = await PATCH(patchRequest({ title: "Valid title" }), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(mocks.authenticateRequest).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/entries/:id", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes through the actor RPC and removes the associated private thumbnail", async () => {
    const thumbnailPath = `${entryId}/thumbnail.webp`;
    const { actor, rpc } = actorWithRpc({ data: thumbnailPath, error: null });
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const from = vi.fn(() => ({ remove }));
    mocks.authenticateRequest.mockResolvedValue(actor);
    mocks.createServiceRoleClient.mockReturnValue({ storage: { from } });

    const response = await DELETE(deleteRequest(), context());

    expect(mocks.authenticateRequest).toHaveBeenCalledWith(expect.any(Request), {
      roles: ["contributor", "administrator"],
      allowApiToken: false,
      requireCsrf: true,
    });
    expect(rpc).toHaveBeenCalledWith("delete_entry", {
      p_actor_user_id: userId,
      p_entry_id: entryId,
    });
    expect(from).toHaveBeenCalledWith("thumbnails");
    expect(remove).toHaveBeenCalledWith([thumbnailPath]);
    expect(await response.json()).toEqual({
      data: { id: entryId, deleted: true, thumbnailCleanupPending: false },
      error: null,
    });
  });

  it("reports a recoverable cleanup state without failing the committed deletion", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const thumbnailPath = `${entryId}/thumbnail.webp`;
    const { actor } = actorWithRpc({ data: thumbnailPath, error: null });
    const remove = vi.fn().mockResolvedValue({ data: null, error: { message: "unavailable" } });
    mocks.authenticateRequest.mockResolvedValue(actor);
    mocks.createServiceRoleClient.mockReturnValue({
      storage: { from: vi.fn(() => ({ remove })) },
    });

    const response = await DELETE(deleteRequest(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { id: entryId, deleted: true, thumbnailCleanupPending: true },
      error: null,
    });
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
