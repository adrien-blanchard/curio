import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EntryModal from "@/components/EntryModal";
import type { CurioEntry, CurioTag } from "@/components/types";
import { getEntryPlaceholderImage } from "@/lib/ui/entry-placeholders";
import { getTintedTagStyle } from "@/lib/ui/tag-colors";

const entryId = "00000000-0000-4000-8000-000000000201";
const userId = "00000000-0000-4000-8000-000000000202";
const uploadPath = `${entryId}/00000000-0000-4000-8000-000000000203.upload`;

const mocks = vi.hoisted(() => ({
  createBrowserSupabaseClient: vi.fn(),
  refresh: vi.fn(),
  storageFrom: vi.fn(),
  uploadToSignedUrl: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: mocks.createBrowserSupabaseClient,
}));

const entry: CurioEntry = {
  id: entryId,
  title: "Safe thumbnails",
  url: "https://example.com/thumbnail-security",
  tldr: "A test entry.",
  thumbnailUrl: null,
  status: "ready",
  sourceType: "opensource",
  tags: [
    {
      id: "00000000-0000-4000-8000-000000000204",
      name: "Research",
      slug: "research",
      color: "#8b5cf6",
    },
  ],
  createdAt: "2026-08-14T00:00:00.000Z",
  createdBy: userId,
};

const editableEntry: CurioEntry = {
  ...entry,
  tldr: "A sufficiently detailed summary that can be saved by an entry owner.",
};

const availableTags: CurioTag[] = [
  entry.tags[0]!,
  ...Array.from({ length: 10 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 205).padStart(12, "0")}`,
    name: `Topic ${index + 2}`,
    slug: `topic-${index + 2}`,
    color: index % 2 === 0 ? "#0ea5e9" : "#10b981",
  })),
];

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("EntryModal detail and management modes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.uploadToSignedUrl.mockResolvedValue({ data: { path: uploadPath }, error: null });
    mocks.storageFrom.mockReturnValue({ uploadToSignedUrl: mocks.uploadToSignedUrl });
    mocks.createBrowserSupabaseClient.mockReturnValue({
      storage: { from: mocks.storageFrom },
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:thumbnail-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts as a read-only detail view and only mounts management controls on request", async () => {
    render(
      <EntryModal entry={entry} role="contributor" currentUserId={userId} onClose={vi.fn()} />,
    );

    const dialog = screen.getByRole("dialog");
    const manageButton = screen.getByRole("button", { name: "Manage entry" });
    const tagsHeading = screen.getByRole("heading", { name: "Tags" });
    const sourceLink = screen.getByRole("link", { name: `Open original: ${entry.title}` });
    const image = dialog.querySelector("img");
    const tag = screen.getByText("Research").closest("li");

    expect(dialog).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("Status: ready")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Status: Ready")).not.toBeInTheDocument();
    expect(screen.getByText("Added AUG 14, 2026")).toHaveClass("text-xs", "font-bold", "uppercase");
    expect(screen.getByText("Open source")).toHaveClass("left-4", "top-4", "bg-slate-950/75");
    expect(screen.getByText("A test entry.")).toBeInTheDocument();
    expect(tag).not.toHaveClass("border");
    const tagStyle = getTintedTagStyle("#8b5cf6");
    expect(tag).toHaveStyle({
      backgroundColor: tagStyle.backgroundColor,
      color: tagStyle.color,
    });
    expect(image).toHaveAttribute("src", getEntryPlaceholderImage(entry.id));
    expect(sourceLink).toHaveTextContent("");
    expect(manageButton.closest("footer")?.firstElementChild).toHaveClass("flex-col");
    expect(manageButton.closest("footer")?.firstElementChild).not.toHaveClass("flex-col-reverse");
    expect(manageButton).toHaveAttribute("aria-expanded", "false");
    expect(manageButton).not.toHaveAttribute("aria-controls");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Replace thumbnail" })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete entry" })).not.toBeInTheDocument();
    expect(
      tagsHeading.compareDocumentPosition(manageButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(manageButton);

    const managementHeading = screen.getByRole("heading", { name: "Manage entry" });
    const managementRegion = screen.getByRole("region", { name: "Manage entry" });
    expect(manageButton).toHaveAttribute("aria-expanded", "true");
    expect(manageButton).toHaveAttribute("aria-controls", managementRegion.id);
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Replace thumbnail" })).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete entry" })).toBeInTheDocument();
    expect(document.getElementById("entry-summary-heading")).not.toBeInTheDocument();
    await waitFor(() => expect(managementHeading).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Back to details" }));
    await waitFor(() => expect(manageButton).toHaveFocus());
    expect(manageButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("A test entry.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("never exposes management controls to readers", () => {
    render(<EntryModal entry={entry} role="reader" onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Manage entry" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete entry" })).not.toBeInTheDocument();
  });

  it("uses an opaque compact badge for non-ready processing states", () => {
    render(<EntryModal entry={{ ...entry, status: "queued" }} role="reader" onClose={vi.fn()} />);

    expect(screen.getByLabelText("Status: Queued")).toHaveClass("bg-white");
    expect(screen.getByLabelText("Status: Queued")).not.toHaveClass("bg-white/90");
  });

  it("hides retry and thumbnail replacement throughout active processing", () => {
    const { rerender } = render(
      <EntryModal
        entry={{ ...entry, status: "queued" }}
        role="contributor"
        currentUserId={userId}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Manage entry" }));
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Replace thumbnail" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Content editing becomes available when processing finishes."),
    ).toBeInTheDocument();

    for (const status of ["analyzing", "finalizing"] as const) {
      rerender(
        <EntryModal
          entry={{ ...entry, status }}
          role="contributor"
          currentUserId={userId}
          onClose={vi.fn()}
        />,
      );
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Replace thumbnail" })).not.toBeInTheDocument();
    }

    rerender(
      <EntryModal
        entry={{ ...entry, status: "failed" }}
        role="contributor"
        currentUserId={userId}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(
      screen.getByText("Run the analysis again without creating a duplicate entry."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Replace thumbnail" })).toBeInTheDocument();
  });

  it("keeps another contributor out while allowing an administrator", () => {
    const { unmount } = render(
      <EntryModal
        entry={entry}
        role="contributor"
        currentUserId="00000000-0000-4000-8000-000000000299"
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Manage entry" })).not.toBeInTheDocument();
    unmount();

    render(<EntryModal entry={entry} role="administrator" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Manage entry" })).toBeInTheDocument();
  });

  it("uses the same deterministic placeholder when a stored thumbnail fails", () => {
    const brokenEntry = {
      ...entry,
      thumbnailUrl: "https://images.example.test/broken.webp",
    };
    render(
      <EntryModal
        entry={brokenEntry}
        role="contributor"
        currentUserId={userId}
        onClose={vi.fn()}
      />,
    );

    const image = screen.getByRole("dialog").querySelector("img");
    expect(image).toHaveAttribute("src", brokenEntry.thumbnailUrl);
    if (!image) throw new Error("Entry preview did not render");
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", getEntryPlaceholderImage(entry.id));
  });

  it("renders a stored workflow placeholder as a labelled local fallback", () => {
    render(
      <EntryModal
        entry={{
          ...entry,
          thumbnailUrl: "https://storage.example.test/workflow-placeholder.webp",
          thumbnailOrigin: "placeholder",
        }}
        role="reader"
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")).toHaveAttribute("src", getEntryPlaceholderImage(entry.id));
    expect(screen.getByText("No preview")).toBeInTheDocument();
  });

  it("validates files locally and revokes superseded preview URLs", async () => {
    const createObjectUrl = vi.mocked(URL.createObjectURL);
    createObjectUrl
      .mockReturnValueOnce("blob:first-thumbnail")
      .mockReturnValueOnce("blob:second-thumbnail");
    const revokeObjectUrl = vi.mocked(URL.revokeObjectURL);

    render(
      <EntryModal entry={entry} role="contributor" currentUserId={userId} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage entry" }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("Thumbnail file input did not render");

    fireEvent.change(input, {
      target: { files: [new File(["unsafe"], "notes.txt", { type: "text/plain" })] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a JPEG, PNG, or WebP image.");
    expect(createObjectUrl).not.toHaveBeenCalled();

    const oversized = new File(["image"], "oversized.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", { configurable: true, value: 5 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(screen.getByRole("alert")).toHaveTextContent("The image must be 5 MiB or smaller.");
    expect(createObjectUrl).not.toHaveBeenCalled();

    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [first] } });
    expect(
      screen.getByRole("region", { name: "Manage entry" }).querySelector("img"),
    ).toHaveAttribute("src", "blob:first-thumbnail");
    fireEvent.change(input, { target: { files: [second] } });
    await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith("blob:first-thumbnail"));

    fireEvent.click(screen.getByRole("button", { name: "Back to details" }));
    await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith("blob:second-thumbnail"));
  });

  it("edits existing tags and source type with catalogue-styled accessible controls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          id: entryId,
          title: editableEntry.title,
          tldr: editableEntry.tldr,
          sourceType: "proprietary",
          status: "ready",
        },
        error: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <EntryModal
        entry={editableEntry}
        allTags={availableTags}
        role="contributor"
        currentUserId={userId}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage entry" }));

    const originalTag = screen.getByRole("button", { name: "Research, selected" });
    const addedTag = screen.getByRole("button", { name: "Topic 2, not selected" });
    expect(originalTag).toHaveAttribute("aria-pressed", "true");
    const originalTagStyle = getTintedTagStyle(availableTags[0]?.color ?? "#64748b");
    expect(originalTag).toHaveStyle({
      backgroundColor: String(originalTagStyle.backgroundColor),
      color: String(originalTagStyle.color),
    });
    expect(addedTag).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(addedTag);
    expect(screen.getByRole("button", { name: "Topic 2, selected" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("2 of 10 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset changes" }));
    expect(screen.getByRole("button", { name: "Topic 2, not selected" })).toBeInTheDocument();
    expect(screen.getByText("1 of 10 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Topic 2, not selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Source type: Open source" }));
    fireEvent.click(screen.getByRole("option", { name: /Proprietary/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/entries/${entryId}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          title: editableEntry.title,
          tldr: editableEntry.tldr,
          sourceType: "proprietary",
          tagIds: [availableTags[0]?.id, availableTags[1]?.id],
        }),
      }),
    );
  });

  it("closes the portaled source menu on Escape without closing the entry dialog", async () => {
    const onClose = vi.fn();
    render(
      <EntryModal
        entry={editableEntry}
        allTags={availableTags}
        role="contributor"
        currentUserId={userId}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Source type: Open source" }));

    const sourceOption = screen.getByRole("option", { name: /Open source/ });
    await waitFor(() => expect(sourceOption).toHaveFocus());
    fireEvent.keyDown(sourceOption, { key: "Escape" });

    expect(screen.queryByRole("listbox", { name: "Source type" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Manage entry" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("caps tag selection at the same ten-tag limit as the update API", () => {
    render(
      <EntryModal
        entry={editableEntry}
        allTags={availableTags}
        role="contributor"
        currentUserId={userId}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage entry" }));

    for (let topic = 2; topic <= 10; topic += 1) {
      fireEvent.click(screen.getByRole("button", { name: `Topic ${topic}, not selected` }));
    }

    expect(screen.getByText("10 of 10 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Topic 11, not selected" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Research, selected" }));
    const replacement = screen.getByRole("button", { name: "Topic 11, not selected" });
    expect(replacement).toBeEnabled();
    fireEvent.click(replacement);
    expect(screen.getByText("10 of 10 selected")).toBeInTheDocument();
  });

  it("serializes mutations atomically and blocks every close path while one is active", async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();

    render(
      <EntryModal
        entry={editableEntry}
        role="contributor"
        currentUserId={userId}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage entry" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("Thumbnail file input did not render");
    fireEvent.change(fileInput, {
      target: { files: [new File(["image"], "ready.png", { type: "image/png" })] },
    });

    const saveButton = screen.getByRole("button", { name: "Save changes" });
    const uploadButton = screen.getByRole("button", { name: "Upload" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    fireEvent.click(uploadButton);

    const managementRegion = screen.getByRole("region", { name: "Manage entry" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(managementRegion).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Saving entry changes.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Summary" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Source type: Open source" })).toBeDisabled();
    expect(fileInput).toBeDisabled();
    expect(uploadButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to details" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Close ${entry.title}` })).toBeDisabled();

    fireEvent.keyDown(document, { key: "Escape" });
    const dialog = screen.getByRole("dialog");
    if (!dialog.parentElement) throw new Error("Dialog backdrop did not render");
    fireEvent.mouseDown(dialog.parentElement);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();

    if (!resolveRequest) throw new Error("Save request did not start");
    resolveRequest(
      jsonResponse({
        data: {
          id: entryId,
          title: editableEntry.title,
          tldr: editableEntry.tldr,
          sourceType: editableEntry.sourceType,
        },
        error: null,
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("recovers from a save error without closing or leaving controls locked", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          data: null,
          error: { code: "ENTRY_UPDATE_FAILED", message: "The edited entry was not saved." },
        },
        500,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();

    render(
      <EntryModal
        entry={editableEntry}
        role="contributor"
        currentUserId={userId}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("The edited entry was not saved.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Manage entry" })).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    expect(screen.getByLabelText("Title")).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("recovers from a save timeout with a clear retryable message", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const onClose = vi.fn();

    render(
      <EntryModal
        entry={editableEntry}
        allTags={availableTags}
        role="contributor"
        currentUserId={userId}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage entry" }));
    const saveButton = screen.getByRole("button", { name: "Save changes" });
    fireEvent.click(saveButton);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(15_000));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Saving took too long. Check your connection and try again.",
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("recovers from a delete error and keeps explicit confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          data: null,
          error: { code: "ENTRY_DELETE_FAILED", message: "The entry could not be removed." },
        },
        500,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();

    render(
      <EntryModal entry={entry} role="administrator" currentUserId={userId} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));

    expect(await screen.findByText("The entry could not be removed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm deletion" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Keep entry" })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows non-ready status compactly and makes a successful retry one-shot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { id: entryId, status: "queued" },
        error: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();

    const { rerender } = render(
      <EntryModal
        entry={{ ...entry, status: "failed" }}
        role="contributor"
        currentUserId={userId}
        onClose={onClose}
      />,
    );

    expect(screen.getByLabelText("Status: Failed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage entry" }));
    const retryButton = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryButton);

    expect(await screen.findByText("Entry queued for processing.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queued" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Queued" }));
    expect(fetchMock).toHaveBeenCalledOnce();

    rerender(
      <EntryModal
        entry={{ ...entry, status: "queued" }}
        role="contributor"
        currentUserId={userId}
        onClose={onClose}
      />,
    );
    expect(screen.queryByRole("button", { name: "Queued" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Replace thumbnail" })).not.toBeInTheDocument();
    rerender(
      <EntryModal
        entry={{ ...entry, status: "analyzing" }}
        role="contributor"
        currentUserId={userId}
        onClose={onClose}
      />,
    );
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    rerender(
      <EntryModal
        entry={{ ...entry, status: "failed" }}
        role="contributor"
        currentUserId={userId}
        onClose={onClose}
      />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled());
  });

  it("prepares, transfers, and finalizes a private signed upload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              upload: {
                bucket: "thumbnail_uploads",
                path: uploadPath,
                token: "signed-token",
                contentType: "image/png",
                maximumBytes: 5 * 1024 * 1024,
              },
            },
            error: null,
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: entryId,
            thumbnailUrl: "https://storage.example.test/signed-preview",
          },
          error: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <EntryModal entry={entry} role="contributor" currentUserId={userId} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage entry" }));
    const input = await waitFor(() => {
      const element = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (!element) throw new Error("Thumbnail file input did not render");
      return element;
    });
    const file = new File([new Uint8Array([1, 2, 3])], "preview.png", {
      type: "image/png",
    });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    const endpoint = `/api/v1/entries/${entryId}/thumbnail`;
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      endpoint,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "prepare",
          contentType: "image/png",
          fileSize: file.size,
        }),
      }),
    );
    expect(mocks.storageFrom).toHaveBeenCalledWith("thumbnail_uploads");
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith(uploadPath, "signed-token", file, {
      cacheControl: "0",
      contentType: "image/png",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      endpoint,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "finalize", uploadPath }),
      }),
    );
    expect(await screen.findByText("Thumbnail updated.")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Manage entry" }).querySelector("img"),
    ).toHaveAttribute("src", "https://storage.example.test/signed-preview");
    fireEvent.click(screen.getByRole("button", { name: "Back to details" }));
    expect(screen.getByRole("dialog").querySelector("img")).toHaveAttribute(
      "src",
      "https://storage.example.test/signed-preview",
    );
    expect(screen.queryByText("No preview")).not.toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("unlocks thumbnail controls when the direct storage transfer exceeds 60 seconds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          data: {
            upload: {
              bucket: "thumbnail_uploads",
              path: uploadPath,
              token: "signed-token",
              contentType: "image/png",
              maximumBytes: 5 * 1024 * 1024,
            },
          },
          error: null,
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    mocks.uploadToSignedUrl.mockImplementationOnce(
      () => new Promise<{ data: null; error: null }>(() => undefined),
    );

    render(
      <EntryModal entry={entry} role="contributor" currentUserId={userId} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage entry" }));
    const file = new File([new Uint8Array([137, 80, 78, 71])], "preview.png", {
      type: "image/png",
    });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    for (let turn = 0; turn < 5; turn += 1) {
      await act(async () => Promise.resolve());
    }
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Uploading…" })).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(60_000));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Uploading took too long. Check your connection and try again.",
    );
    expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
