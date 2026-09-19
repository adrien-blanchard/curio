import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import EntryCard from "@/components/EntryCard";
import DashboardGrid from "@/components/DashboardGrid";
import type { CurioEntry } from "@/components/types";
import { getEntryPlaceholderImage } from "@/lib/ui/entry-placeholders";
import { getTintedTagStyle } from "@/lib/ui/tag-colors";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

const entry: CurioEntry = {
  id: "00000000-0000-4000-8000-000000000401",
  title: "Accessible knowledge card",
  url: "https://example.com/card",
  tldr: "The private catalogue now shares the polished card presentation from the public demo.",
  thumbnailUrl: null,
  status: "ready",
  sourceType: "opensource",
  tags: [
    {
      id: "00000000-0000-4000-8000-000000000402",
      name: "Research",
      slug: "research",
      color: "#8b5cf6",
    },
  ],
  createdAt: "2026-08-17T00:00:00.000Z",
  createdBy: "00000000-0000-4000-8000-000000000403",
  authorEmail: "ada@example.com",
  authorDisplayName: "Ada Lovelace",
  authorAvatarUrl: "https://lh3.googleusercontent.com/a/ada",
};

const entryWithManyTags: CurioEntry = {
  ...entry,
  tags: [
    entry.tags[0],
    {
      id: "00000000-0000-4000-8000-000000000404",
      name: "Computer Vision",
      slug: "computer-vision",
      color: "#0284c7",
    },
    {
      id: "00000000-0000-4000-8000-000000000405",
      name: "Open Source",
      slug: "open-source",
      color: "#059669",
    },
    {
      id: "00000000-0000-4000-8000-000000000406",
      name: "Developer Tools",
      slug: "developer-tools",
      color: "#ea580c",
    },
    {
      id: "00000000-0000-4000-8000-000000000407",
      name: "Rendering",
      slug: "rendering",
      color: "#db2777",
    },
  ],
};

function relativeLuminance(color: string): number {
  const channels = color
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

describe("EntryCard demo presentation", () => {
  it("uses the demo shape, opens from its non-interactive surface, and preserves author controls", () => {
    const onOpenModal = vi.fn();
    const onAuthorFilter = vi.fn();
    const { container } = render(
      <EntryCard
        entry={entry}
        role="reader"
        onOpenModal={onOpenModal}
        onAuthorFilter={onAuthorFilter}
      />,
    );

    expect(container.querySelector("article")).toHaveClass(
      "rounded-3xl",
      "focus-within:-translate-y-1",
      "motion-reduce:transform-none",
    );
    expect(container.querySelector("article > div")).toHaveClass("aspect-[21/9]");
    expect(container.querySelector("article img")).toHaveClass(
      "group-hover:scale-[1.03]",
      "motion-reduce:transform-none",
    );

    fireEvent.click(screen.getByRole("button", { name: `View ${entry.title}` }));
    expect(onOpenModal).toHaveBeenCalledTimes(1);

    const authorButton = screen.getByRole("button", {
      name: "Filter by author Ada Lovelace (ada@example.com)",
    });
    expect(authorButton.querySelector("img")).toHaveAttribute(
      "src",
      "https://lh3.googleusercontent.com/a/ada",
    );
    fireEvent.click(authorButton);
    expect(onAuthorFilter).toHaveBeenCalledWith("ada@example.com");
    expect(onOpenModal).toHaveBeenCalledTimes(1);

    const originalLink = screen.getByRole("link", { name: `Open original: ${entry.title}` });
    expect(originalLink).toHaveAttribute("href", entry.url);
    expect(originalLink).toHaveClass(
      "bg-blue-50",
      "text-primary",
      "ring-blue-100",
      "hover:bg-primary",
      "hover:text-white",
      "hover:-translate-y-0.5",
    );
    expect(originalLink).toHaveTextContent("");
    fireEvent.click(originalLink);
    expect(onOpenModal).toHaveBeenCalledTimes(1);
  });

  it("shows source and date like the demo, reserves three summary lines, and hides Ready", () => {
    const { container } = render(<EntryCard entry={entry} role="reader" />);

    const sourceBadge = screen.getByText("Open source");
    expect(sourceBadge).toHaveClass("left-4", "top-4", "bg-slate-950/75");
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();

    const date = screen.getByText("Aug 17, 2026");
    expect(date).toHaveClass("font-bold", "uppercase", "text-slate-500");

    const summary = screen.getByText(entry.tldr!);
    expect(summary).toHaveClass("line-clamp-3", "h-[4.3rem]");
    expect(container.querySelector("article")).not.toHaveTextContent("Open original");
  });

  it("labels the deterministic local placeholder when the thumbnail is missing", () => {
    const expectedPlaceholder = getEntryPlaceholderImage(entry.id);
    const { container } = render(<EntryCard entry={entry} role="reader" />);
    expect(container.querySelector("article img")).toHaveAttribute("src", expectedPlaceholder);
    expect(screen.getByText("No preview")).toHaveClass(
      "bg-white/65",
      "text-slate-700",
      "ring-white/70",
      "backdrop-blur-md",
    );
  });

  it("ignores a stored workflow placeholder and renders the local placeholder treatment", () => {
    const workflowPlaceholder = {
      ...entry,
      thumbnailUrl: "https://storage.example.test/workflow-placeholder.webp",
      thumbnailOrigin: "placeholder" as const,
    };
    const expectedPlaceholder = getEntryPlaceholderImage(entry.id);
    const { container } = render(<EntryCard entry={workflowPlaceholder} role="reader" />);

    expect(container.querySelector("article img")).toHaveAttribute("src", expectedPlaceholder);
    expect(screen.getByText("No preview")).toBeInTheDocument();
  });

  it("only labels the local placeholder after a real thumbnail fails", () => {
    const entryWithBrokenImage = {
      ...entry,
      thumbnailUrl: "https://images.example.com/broken.webp",
    };
    const expectedPlaceholder = getEntryPlaceholderImage(entry.id);
    const { container } = render(<EntryCard entry={entryWithBrokenImage} role="reader" />);
    const image = container.querySelector("article img")!;
    expect(image).toHaveAttribute("src", entryWithBrokenImage.thumbnailUrl);
    expect(screen.queryByText("No preview")).not.toBeInTheDocument();

    fireEvent.error(image);
    expect(container.querySelector("article img")).toHaveAttribute("src", expectedPlaceholder);
    expect(screen.getByText("No preview")).toBeInTheDocument();
  });

  it("shows three tags plus an accessible overflow popover without opening the entry", () => {
    const onOpenModal = vi.fn();
    render(<EntryCard entry={entryWithManyTags} role="reader" onOpenModal={onOpenModal} />);

    const visibleTagList = screen.getByRole("list", { name: "Tags" });
    expect(within(visibleTagList).getAllByRole("listitem")).toHaveLength(3);

    const moreButton = screen.getByRole("button", {
      name: `Show all 5 tags for ${entry.title}`,
    });
    expect(moreButton).toHaveTextContent("+2");
    expect(moreButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(moreButton);
    expect(onOpenModal).not.toHaveBeenCalled();
    expect(moreButton).toHaveAttribute("aria-expanded", "true");

    const popover = screen.getByRole("dialog", { name: "All tags" });
    expect(popover).toHaveFocus();
    expect(
      within(popover).getByRole("list", { name: `All tags for ${entry.title}` }),
    ).toHaveTextContent("ResearchComputer VisionOpen SourceDeveloper ToolsRendering");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "All tags" })).not.toBeInTheDocument();
    expect(moreButton).toHaveFocus();
    expect(onOpenModal).not.toHaveBeenCalled();

    fireEvent.click(moreButton);
    expect(screen.getByRole("dialog", { name: "All tags" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "All tags" })).not.toBeInTheDocument();
  });

  it("keeps non-ready status compact on the image", () => {
    render(<EntryCard entry={{ ...entry, status: "analyzing" }} role="reader" />);
    const status = screen.getByText("Analyzing");
    expect(status).toHaveClass(
      "bottom-4",
      "left-4",
      "bg-white",
      "sm:bottom-auto",
      "sm:left-auto",
      "sm:right-4",
      "sm:top-4",
    );
  });

  it("offers Retry only for a manageable failed entry", () => {
    const retryName = `Retry processing for ${entry.title}`;
    const { rerender } = render(
      <EntryCard
        entry={{ ...entry, status: "failed" }}
        role="contributor"
        currentUserId={entry.createdBy ?? undefined}
      />,
    );

    expect(screen.getByRole("button", { name: retryName })).toHaveAttribute(
      "title",
      "Retry processing",
    );

    for (const status of ["queued", "analyzing", "finalizing", "ready"] as const) {
      rerender(
        <EntryCard
          entry={{ ...entry, status }}
          role="contributor"
          currentUserId={entry.createdBy ?? undefined}
        />,
      );
      expect(screen.queryByRole("button", { name: retryName })).not.toBeInTheDocument();
      expect(screen.queryByTitle("Resume processing")).not.toBeInTheDocument();
    }

    rerender(
      <EntryCard
        entry={{ ...entry, status: "failed" }}
        role="contributor"
        currentUserId="00000000-0000-4000-8000-000000000499"
      />,
    );
    expect(screen.queryByRole("button", { name: retryName })).not.toBeInTheDocument();

    rerender(<EntryCard entry={{ ...entry, status: "failed" }} role="reader" />);
    expect(screen.queryByRole("button", { name: retryName })).not.toBeInTheDocument();

    rerender(<EntryCard entry={{ ...entry, status: "failed" }} role="administrator" />);
    expect(screen.getByRole("button", { name: retryName })).toBeInTheDocument();
  });

  it("keeps dashboard cards comfortable beside the sidebar", () => {
    const { container } = render(
      <DashboardGrid entries={[entry]} allTags={entry.tags} role="reader" />,
    );
    const grid = container.querySelector("section > div");
    expect(grid).toHaveClass(
      "mx-auto",
      "w-full",
      "max-w-[1400px]",
      "grid-cols-1",
      "gap-5",
      "min-[840px]:grid-cols-2",
      "2xl:grid-cols-3",
    );
    expect(grid).not.toHaveClass("2xl:grid-cols-4");
  });

  it("uses borderless tinted tags and darkens light taxonomy colours accessibly", () => {
    render(<EntryCard entry={entry} role="reader" />);
    const tag = screen.getByText("Research").closest("li");
    expect(tag).not.toHaveClass("border");
    expect(tag?.querySelector("svg")).not.toBeInTheDocument();

    const lightStyle = getTintedTagStyle("#f59e0b");
    const foreground = String(lightStyle.color);
    const background = String(lightStyle.backgroundColor);
    expect(foreground).not.toBe("#f59e0b");
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});
