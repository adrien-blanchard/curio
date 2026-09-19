import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FilterBar from "@/components/FilterBar";
import type { CurioTag } from "@/components/types";
import { getWhiteTextTagStyle } from "@/lib/ui/tag-colors";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams("q=vision&page=2"),
}));

const tags: CurioTag[] = [
  ["Research", "research", "#8b5cf6"],
  ["Audio", "audio", "#10b981"],
  ["Computer Vision", "computer-vision", "#06b6d4"],
  ["Rendering", "rendering", "#f97316"],
  ["Developer Tools", "developer-tools", "#eab308"],
  ["Open Source", "open-source", "#ec4899"],
  ["Image Editing", "image-editing", "#6366f1"],
].map(([name, slug, color], index) => ({
  id: `00000000-0000-4000-8000-${String(index + 501).padStart(12, "0")}`,
  name,
  slug,
  color,
}));

const fifteenTags: CurioTag[] = [
  ...tags,
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 601).padStart(12, "0")}`,
    name: `Topic ${index + 8}`,
    slug: `topic-${index + 8}`,
    color: "#64748b",
  })),
];

describe("FilterBar", () => {
  beforeEach(() => mocks.push.mockClear());

  it("uses the author list for a server-side URL filter", () => {
    render(
      <FilterBar
        allTags={[]}
        uniqueAuthors={[
          {
            value: "ada@example.com",
            email: "ada@example.com",
            label: "Ada Lovelace",
            displayName: "Ada Lovelace",
            avatarUrl: "https://lh3.googleusercontent.com/a/ada",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Author: All users" }));
    const ada = screen.getByRole("option", { name: /Ada Lovelace/ });
    expect(ada.querySelector("img")).toHaveAttribute(
      "src",
      "https://lh3.googleusercontent.com/a/ada",
    );
    fireEvent.click(ada);

    expect(mocks.push).toHaveBeenCalledWith("/dashboard?q=vision&author=ada%40example.com");
  });

  it("shows the complete taxonomy as wrapping white chips with accessible selected colours", () => {
    const { container } = render(<FilterBar allTags={fifteenTags} currentTags={["audio"]} />);
    expect(screen.getByRole("region", { name: "Entry filters" })).toHaveClass("space-y-3");
    const tagFilters = screen.getByRole("group", { name: "Tag filters" });
    const tagButtons = within(tagFilters)
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("aria-pressed"));
    expect(tagButtons).toHaveLength(15);
    expect(tagFilters).toHaveClass("flex", "flex-wrap");
    expect(screen.queryByRole("heading", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("sr-only");

    const activeTag = within(tagFilters).getByRole("button", { name: "Audio" });
    const activeStyle = getWhiteTextTagStyle("#10b981");

    expect(activeTag).toHaveStyle(
      `background-color: ${String(activeStyle.backgroundColor)}; color: #ffffff;`,
    );
    expect(activeStyle.backgroundColor).not.toBe("#10b981");
    expect(activeTag).toHaveClass("rounded-full", "px-5", "py-2", "text-sm", "border");
    expect(activeTag).toHaveAttribute("aria-pressed", "true");

    const inactiveTag = within(tagFilters).getByRole("button", { name: "Research" });
    expect(inactiveTag).toHaveClass(
      "rounded-full",
      "border-slate-200",
      "bg-white",
      "text-[#1B254B]",
    );
    expect(inactiveTag).not.toHaveAttribute("style");
    expect(inactiveTag).toHaveAttribute("aria-pressed", "false");

    expect(container.querySelector('[class*="overflow-x-auto"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Scroll tags/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All tags" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More tags" })).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "Search tags" })).not.toBeInTheDocument();
  });

  it("only shows the discreet desktop clear action when filters are active", () => {
    render(<FilterBar allTags={tags} currentTags={["research"]} />);

    const desktopTags = screen.getByRole("group", { name: "Tag filters" });
    const clearFilters = within(desktopTags).getByRole("button", { name: "Clear filters" });
    expect(desktopTags.lastElementChild).toBe(clearFilters);
    fireEvent.click(clearFilters);

    expect(mocks.push).toHaveBeenCalledWith("/dashboard?q=vision");
    expect(within(desktopTags).queryByRole("button", { name: "Clear filters" })).toBeNull();
    expect(within(desktopTags).getByRole("button", { name: "Research" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("opens one mobile Tags panel, moves focus inside, and keeps it open while selecting", async () => {
    render(<FilterBar allTags={tags} currentTags={["research"]} />);

    const trigger = screen.getByRole("button", { name: "Tags, 1 selected" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("aria-controls");

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Tags" });
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Close tags" })).toHaveFocus(),
    );
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", "mobile-tags-panel");
    expect(within(dialog).queryByRole("searchbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Combine up to/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveClass("sr-only");
    expect(within(dialog).getByRole("group", { name: "Mobile tag filters" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Audio" }));

    expect(mocks.push).toHaveBeenCalledWith("/dashboard?q=vision&tags=research%2Caudio");
    expect(screen.getByRole("dialog", { name: "Tags" })).toBeInTheDocument();
    expect(trigger).toHaveAccessibleName("Tags, 2 selected");

    fireEvent.click(within(dialog).getByRole("button", { name: "Clear filters" }));
    expect(mocks.push).toHaveBeenLastCalledWith("/dashboard?q=vision");
    expect(screen.getByRole("dialog", { name: "Tags" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Close tags" })).toHaveFocus();
    expect(trigger).toHaveAccessibleName("Tags, 0 selected");
  });

  it("accumulates rapid tag clicks and ignores a stale intermediate navigation", () => {
    const { rerender } = render(<FilterBar allTags={tags} currentTags={["research"]} />);
    let desktopTags = screen.getByRole("group", { name: "Tag filters" });
    fireEvent.click(within(desktopTags).getByRole("button", { name: "Audio" }));
    desktopTags = screen.getByRole("group", { name: "Tag filters" });
    fireEvent.click(within(desktopTags).getByRole("button", { name: "Computer Vision" }));

    expect(mocks.push).toHaveBeenNthCalledWith(1, "/dashboard?q=vision&tags=research%2Caudio");
    expect(mocks.push).toHaveBeenNthCalledWith(
      2,
      "/dashboard?q=vision&tags=research%2Caudio%2Ccomputer-vision",
    );

    rerender(<FilterBar allTags={tags} currentTags={["research", "audio"]} />);
    desktopTags = screen.getByRole("group", { name: "Tag filters" });
    expect(within(desktopTags).getByRole("button", { name: "Computer Vision" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    rerender(<FilterBar allTags={tags} currentTags={["research", "audio", "computer-vision"]} />);
    expect(
      within(screen.getByRole("group", { name: "Tag filters" })).getByRole("button", {
        name: "Computer Vision",
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("closes the mobile panel with Escape and restores focus", async () => {
    render(<FilterBar allTags={tags} />);

    const trigger = screen.getByRole("button", { name: "Tags, 0 selected" });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("button", { name: "Close tags" })).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Tags" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes the mobile panel on an outside pointer press", () => {
    render(<FilterBar allTags={tags} />);

    fireEvent.click(screen.getByRole("button", { name: "Tags, 0 selected" }));
    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("dialog", { name: "Tags" })).not.toBeInTheDocument();
  });

  it("keeps keyboard focus inside the mobile dialog", async () => {
    render(<FilterBar allTags={tags} />);

    fireEvent.click(screen.getByRole("button", { name: "Tags, 0 selected" }));
    const dialog = screen.getByRole("dialog", { name: "Tags" });
    const close = within(dialog).getByRole("button", { name: "Close tags" });
    const lastTag = within(dialog).getByRole("button", { name: "Image Editing" });
    await waitFor(() => expect(close).toHaveFocus());

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(lastTag).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
  });

  it("makes the five-tag limit explicit and prevents a silent sixth selection", () => {
    const selectedSlugs = tags.slice(0, 5).map((tag) => tag.slug);
    render(<FilterBar allTags={tags} currentTags={selectedSlugs} />);

    const desktopFilters = screen.getByRole("group", { name: "Tag filters" });
    const desktopStatus = screen.getByRole("status");
    expect(desktopStatus).toHaveClass("sr-only");
    expect(desktopStatus).toHaveTextContent(
      "5 of 5 selected. Limit reached; remove one to choose another.",
    );
    expect(desktopFilters).toHaveAttribute("aria-describedby", "desktop-tag-filter-count");
    const desktopSixthTag = within(desktopFilters).getByRole("button", { name: "Open Source" });
    expect(desktopSixthTag).toBeDisabled();
    expect(desktopSixthTag).toHaveAttribute("aria-describedby", "desktop-tag-filter-count");

    fireEvent.click(screen.getByRole("button", { name: "Tags, 5 selected" }));
    const dialog = screen.getByRole("dialog", { name: "Tags" });
    const mobileStatus = within(dialog).getByRole("status");
    expect(mobileStatus).toHaveClass("sr-only");
    expect(mobileStatus).toHaveTextContent(
      "5 of 5 selected. Limit reached; remove one to choose another.",
    );

    const sixthTag = within(dialog).getByRole("button", { name: "Open Source" });
    expect(sixthTag).toBeDisabled();
    fireEvent.click(sixthTag);
    expect(mocks.push).not.toHaveBeenCalled();

    const selectedTag = within(dialog).getByRole("button", { name: "Research" });
    expect(selectedTag).toBeEnabled();
    fireEvent.click(selectedTag);
    expect(mocks.push).toHaveBeenCalledWith(
      "/dashboard?q=vision&tags=audio%2Ccomputer-vision%2Crendering%2Cdeveloper-tools",
    );
    expect(screen.getByRole("dialog", { name: "Tags" })).toBeInTheDocument();
  });

  it("does not render tag controls when the taxonomy is empty", () => {
    render(<FilterBar allTags={[]} />);

    expect(screen.queryByRole("group", { name: "Tag filters" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tags, \d+ selected/ })).not.toBeInTheDocument();
  });
});
