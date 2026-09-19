import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AdminTokenInventory from "@/app/dashboard/admin/AdminTokenInventory";

const tokenId = "00000000-0000-4000-8000-000000000301";

function listResponse(revokedAt: string | null = null) {
  return new Response(
    JSON.stringify({
      data: {
        tokens: [
          {
            id: tokenId,
            name: "Recruiter demo extension",
            token_prefix: "curio_pat_example",
            scopes: ["entries:write", "tags:read", "profile:read"],
            expires_at: null,
            last_used_at: null,
            revoked_at: revokedAt,
            created_at: "2026-08-14T00:00:00.000Z",
            owner_email: "member@example.test",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      },
      error: null,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("administrator token inventory", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires explicit confirmation before revoking another member's token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: tokenId, revoked: true }, error: null })),
      )
      .mockResolvedValueOnce(listResponse("2026-08-14T01:00:00.000Z"));
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminTokenInventory />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Confirm revocation/u })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Confirm revocation/u }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/tokens/${tokenId}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(await screen.findByText("Revoked")).toBeInTheDocument();
  });
});
