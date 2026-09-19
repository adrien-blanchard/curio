import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AdminTable from "@/components/AdminTable";

describe("team member table", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the Google profile name and avatar when available", () => {
    const userId = "00000000-0000-4000-8000-000000000601";
    const avatarUrl = "https://lh3.googleusercontent.com/a/curio=s96-c";

    const { container } = render(
      <AdminTable
        currentUserId={userId}
        initialUsers={[
          {
            id: userId,
            email: "ada@example.test",
            displayName: "Ada Lovelace",
            avatarUrl,
            role: "administrator",
            createdAt: "2026-08-17T00:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
    expect(screen.getByText("ada@example.test")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", avatarUrl);
    expect(screen.getByText("(you)")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Administrator").closest("span")).toHaveClass(
      "bg-[#EAF6FF]",
      "text-[#005C9E]",
    );
  });

  it("keeps member roles editable with the shared role presentation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { role: "contributor" }, error: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <AdminTable
        currentUserId="00000000-0000-4000-8000-000000000601"
        initialUsers={[
          {
            id: "00000000-0000-4000-8000-000000000602",
            email: "grace@example.test",
            displayName: "Grace Hopper",
            role: "reader",
            createdAt: "2026-08-17T00:00:00.000Z",
          },
        ]}
      />,
    );

    expect(container.querySelector("select")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", {
      name: "Role for grace@example.test: Reader",
    });
    expect(trigger).toHaveClass("bg-[#F1F5F9]", "text-[#475569]");

    fireEvent.click(trigger);
    expect(
      screen.getByRole("listbox", { name: "Role for grace@example.test" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Contributor" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/users/00000000-0000-4000-8000-000000000602",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ role: "contributor" }),
      }),
    );
    expect(await screen.findByText("Role updated to Contributor.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Role for grace@example.test: Contributor" }),
    ).toHaveClass("bg-[#ECFDF5]", "text-[#047857]");
  });
});
