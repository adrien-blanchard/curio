import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOptionalServerMetadata: vi.fn(),
  redirect: vi.fn(),
  requirePageActor: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/page", () => ({ requirePageActor: mocks.requirePageActor }));
vi.mock("@/lib/env/server", () => ({
  getOptionalServerMetadata: mocks.getOptionalServerMetadata,
}));
vi.mock("@/app/dashboard/admin/AdminTokenInventory", () => ({
  default: () => <div>Token inventory</div>,
}));

import AdminPage from "@/app/dashboard/admin/page";

const actorId = "00000000-0000-4000-8000-000000000601";

function profile(id = actorId) {
  return {
    id,
    email: "ada@example.test",
    role: "administrator",
    display_name: "Ada Lovelace",
    avatar_url: null,
    created_at: "2026-08-17T00:00:00.000Z",
    is_active: true,
  } as const;
}

function setupActor(data: ReturnType<typeof profile>[], count: number) {
  const query = {
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
  };
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.range.mockResolvedValue({ data, error: null, count });

  const select = vi.fn().mockReturnValue(query);
  const from = vi.fn().mockReturnValue({ select });
  mocks.requirePageActor.mockResolvedValue({
    role: "administrator",
    user: {
      id: actorId,
      email: "ada@example.test",
      displayName: "Ada Lovelace",
      avatarUrl: null,
    },
    supabase: { from },
  });

  return { from, query, select };
}

describe("members and access page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOptionalServerMetadata.mockReturnValue({ EXTENSION_ENABLED: false });
  });

  it("loads only active members and explains the single-member state", async () => {
    const { from, query, select } = setupActor([profile()], 1);

    render(await AdminPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Members & access" })).toBeInTheDocument();
    expect(screen.getByText("View members and assign their Curio roles.")).toBeInTheDocument();
    expect(screen.getByText("Only you have joined this Curio instance.")).toBeInTheDocument();
    expect(
      screen.getByText("Allowed members appear here after their first sign-in."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Advanced")).not.toBeInTheDocument();

    expect(from).toHaveBeenCalledWith("profiles");
    expect(select).toHaveBeenCalledWith(
      "id, email, role, display_name, avatar_url, created_at, is_active",
      { count: "exact" },
    );
    expect(query.eq).toHaveBeenCalledWith("is_active", true);
    expect(query.order).toHaveBeenNthCalledWith(1, "created_at", { ascending: false });
    expect(query.order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
    expect(query.range).toHaveBeenCalledWith(0, 49);
  });

  it("uses the active count for deterministic pagination", async () => {
    const secondPageMember = profile("00000000-0000-4000-8000-000000000699");
    const { query } = setupActor([secondPageMember], 51);

    render(await AdminPage({ searchParams: Promise.resolve({ page: "2" }) }));

    expect(screen.getByText("Page 2 of 2 · 51 members")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/dashboard/admin",
    );
    expect(screen.queryByRole("link", { name: "Next" })).not.toBeInTheDocument();
    expect(query.range).toHaveBeenCalledWith(50, 99);
  });
});
