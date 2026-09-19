import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SubmitLinkModal from "@/components/SubmitLinkModal";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SubmitLinkModal resilience", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("unlocks the form with a clear message when submission times out", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { tags: [] }, error: null }))
      .mockImplementationOnce(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();

    render(<SubmitLinkModal isOpen onClose={onClose} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(await screen.findByText("No tags are available.")).toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com/resource" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(15_000));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Submitting took too long. Check your connection and try again.",
    );
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
