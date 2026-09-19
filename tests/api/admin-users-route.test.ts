import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actorId = "00000000-0000-4000-8000-000000000331";
const profileId = "00000000-0000-4000-8000-000000000332";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}));

import { PATCH } from "@/app/api/v1/admin/users/[id]/route";

function request(body: unknown) {
  return new Request(`https://curio.example.test/api/v1/admin/users/${profileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: "https://curio.example.test" },
    body: JSON.stringify(body),
  });
}

function context(id = profileId) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/v1/admin/users/:id", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.authenticateRequest.mockResolvedValue({ user: { id: actorId }, role: "administrator" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires an administrator browser session and returns the updated profile envelope", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: profileId,
          email: "reader@example.test",
          role: "contributor",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      error: null,
    });
    mocks.createServiceRoleClient.mockReturnValue({ rpc });

    const response = await PATCH(request({ role: "contributor" }), context());

    expect(mocks.authenticateRequest).toHaveBeenCalledWith(expect.any(Request), {
      roles: ["administrator"],
      allowApiToken: false,
      requireCsrf: true,
    });
    expect(rpc).toHaveBeenCalledWith("update_profile_role", {
      p_actor_user_id: actorId,
      p_profile_id: profileId,
      p_role: "contributor",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        id: profileId,
        email: "reader@example.test",
        role: "contributor",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    });
  });

  it("maps last-administrator protection to the stable conflict envelope", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23514", message: "LAST_ADMIN_REQUIRED" },
    });
    mocks.createServiceRoleClient.mockReturnValue({ rpc });

    const response = await PATCH(request({ role: "reader" }), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      data: null,
      error: {
        code: "LAST_ADMIN_REQUIRED",
        message: "The last administrator cannot be removed or demoted",
      },
    });
  });

  it.each([
    ["an unsupported role", { role: "owner" }],
    ["an unknown field", { role: "reader", isAdministrator: true }],
  ])("rejects %s before invoking the administrator RPC", async (_label, body) => {
    const rpc = vi.fn();
    mocks.createServiceRoleClient.mockReturnValue({ rpc });

    const response = await PATCH(request(body), context());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed profile UUID before authentication", async () => {
    const response = await PATCH(request({ role: "reader" }), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(mocks.authenticateRequest).not.toHaveBeenCalled();
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });
});
