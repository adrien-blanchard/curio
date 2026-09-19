import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  requirePageActor: vi.fn(),
  rpc: vi.fn(),
  single: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/page", () => ({ requirePageActor: mocks.requirePageActor }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({ rpc: mocks.rpc }),
}));

import { createTagAction } from "@/app/dashboard/tags/actions";

describe("tag server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePageActor.mockResolvedValue({
      role: "administrator",
      user: { id: "00000000-0000-4000-8000-000000000401" },
    });
    mocks.rpc.mockReturnValue({ single: mocks.single });
  });

  it("generates the slug and colour for a quick-added tag", async () => {
    mocks.single.mockResolvedValue({
      data: {
        id: "00000000-0000-4000-8000-000000000402",
        name: "Engineering",
        slug: "engineering",
        color: "#0075c9",
        sort_order: 10,
        created_at: "2026-08-14T00:00:00.000Z",
        updated_at: "2026-08-14T00:00:00.000Z",
      },
      error: null,
    });

    await expect(createTagAction({ name: "Engineering" })).resolves.toEqual({
      ok: true,
      tag: {
        id: "00000000-0000-4000-8000-000000000402",
        name: "Engineering",
        slug: "engineering",
        color: "#0075c9",
      },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("create_tag", {
      p_actor_user_id: "00000000-0000-4000-8000-000000000401",
      p_name: "Engineering",
      p_slug: "engineering",
      p_color: "#8B5CF6",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/tags");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });
});
