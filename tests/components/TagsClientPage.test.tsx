import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTintedTagStyle } from "@/lib/ui/tag-colors";

const mocks = vi.hoisted(() => ({
  createTagAction: vi.fn(),
  deleteTagAction: vi.fn(),
  updateTagAction: vi.fn(),
}));

vi.mock("@/app/dashboard/tags/actions", () => mocks);

import TagsClientPage, { type TaxonomyTag } from "@/app/dashboard/tags/TagsClientPage";

const tags: TaxonomyTag[] = [
  {
    id: "00000000-0000-4000-8000-000000000501",
    name: "Computer Vision",
    slug: "computer-vision",
    color: "#0075C9",
    usageCount: 8,
  },
  {
    id: "00000000-0000-4000-8000-000000000502",
    name: "Research",
    slug: "research",
    color: "#8B5CF6",
    usageCount: 3,
  },
];

describe("tags and topics page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the simple legacy vocabulary and keeps slugs out of the default view", () => {
    render(<TagsClientPage initialTags={tags} role="administrator" />);

    expect(screen.getByText("Total Tags")).toBeInTheDocument();
    expect(screen.getByText("Most Popular")).toBeInTheDocument();
    expect(screen.getByText("All Tags")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Display Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Usage Count" })).toBeInTheDocument();
    expect(screen.queryByText("computer-vision")).not.toBeInTheDocument();
    const researchTag = screen.getByText("Research");
    const researchTagStyle = getTintedTagStyle("#8B5CF6");
    expect(researchTag).toHaveStyle(
      `background-color: ${String(researchTagStyle.backgroundColor)}; color: ${String(researchTagStyle.color)};`,
    );
    expect(researchTag).toHaveClass("rounded-lg");
    expect(researchTag).not.toHaveClass("border");

    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Computer Vision" }));
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Advanced"));
    expect(screen.getByLabelText(/Slug/u)).toHaveValue("computer-vision");
  });

  it("quick-adds a tag from its display name only", async () => {
    mocks.createTagAction.mockResolvedValue({
      ok: true,
      tag: {
        id: "00000000-0000-4000-8000-000000000503",
        name: "Design Systems",
        slug: "design-systems",
        color: "#10B981",
      },
    });
    render(<TagsClientPage initialTags={tags} role="administrator" />);

    fireEvent.change(screen.getByLabelText("Tag name"), {
      target: { value: "Design Systems" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(mocks.createTagAction).toHaveBeenCalledWith({ name: "Design Systems" }),
    );
    expect(await screen.findByText("Design Systems was added.")).toBeInTheDocument();
  });

  it("keeps a deferred mutation pending and ignores a duplicate submit", async () => {
    let resolveCreate!: (result: {
      ok: true;
      tag: { id: string; name: string; slug: string; color: string };
    }) => void;
    const pendingCreate = new Promise<{
      ok: true;
      tag: { id: string; name: string; slug: string; color: string };
    }>((resolve) => {
      resolveCreate = resolve;
    });
    mocks.createTagAction.mockReturnValue(pendingCreate);
    render(<TagsClientPage initialTags={tags} role="administrator" />);

    const nameInput = screen.getByLabelText("Tag name");
    fireEvent.change(nameInput, { target: { value: "Deferred Tag" } });
    const addButton = screen.getByRole("button", { name: "Add" });
    fireEvent.click(addButton);
    fireEvent.click(addButton);

    expect(mocks.createTagAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(nameInput).toBeDisabled());

    await act(async () => {
      resolveCreate({
        ok: true,
        tag: {
          id: "00000000-0000-4000-8000-000000000504",
          name: "Deferred Tag",
          slug: "deferred-tag",
          color: "#6366F1",
        },
      });
      await pendingCreate;
    });

    expect(await screen.findByText("Deferred Tag was added.")).toBeInTheDocument();
    await waitFor(() => expect(nameInput).toBeEnabled());
  });

  it("keeps tag management read-only for non-administrators", () => {
    render(<TagsClientPage initialTags={tags} role="contributor" />);

    expect(screen.queryByRole("button", { name: "Manage" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tag name")).not.toBeInTheDocument();
    expect(screen.getByText("Administrators manage the shared tag list.")).toBeInTheDocument();
  });
});
