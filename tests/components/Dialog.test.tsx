import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Dialog from "@/components/Dialog";

describe("Dialog focus and close behavior", () => {
  it("keeps focus stable when the latest onClose callback changes", async () => {
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const { rerender } = render(
      <Dialog isOpen title="Stable dialog" onClose={firstClose}>
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog).toHaveFocus());
    const lastAction = screen.getByRole("button", { name: "Last action" });
    lastAction.focus();

    rerender(
      <Dialog isOpen title="Stable dialog" onClose={latestClose}>
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </Dialog>,
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });

    expect(lastAction).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(firstClose).not.toHaveBeenCalled();
    expect(latestClose).toHaveBeenCalledOnce();
  });

  it("blocks its close button, Escape, and backdrop while closing is disabled", () => {
    const onClose = vi.fn();
    render(
      <Dialog isOpen title="Busy dialog" onClose={onClose} closeDisabled>
        <p>Working</p>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog");
    const closeButton = screen.getByRole("button", { name: "Close Busy dialog" });
    expect(closeButton).toBeDisabled();
    fireEvent.click(closeButton);
    fireEvent.keyDown(document, { key: "Escape" });
    if (!dialog.parentElement) throw new Error("Dialog backdrop did not render");
    fireEvent.mouseDown(dialog.parentElement);
    expect(onClose).not.toHaveBeenCalled();
  });
});
