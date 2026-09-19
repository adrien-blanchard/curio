import "@testing-library/jest-dom/vitest";

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import EntryCard from "@/components/EntryCard";
import type { CurioEntry } from "@/components/types";
import { PROCESSING_DELAY_WARNING_MS } from "@/components/processing-state";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const processingEntry: CurioEntry = {
  id: "00000000-0000-4000-8000-000000000701",
  title: "Processing resilience",
  url: "https://example.com/resilience",
  tldr: null,
  thumbnailUrl: null,
  status: "analyzing",
  sourceType: "opensource",
  tags: [],
  createdAt: "2026-08-18T12:00:00.000Z",
  processingHeartbeatAt: "2026-08-18T12:00:00.000Z",
  createdBy: "00000000-0000-4000-8000-000000000702",
};

describe("entry processing resilience", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the delayed warning at 2:00, not at 1:59", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(processingEntry.processingHeartbeatAt!));
    render(<EntryCard entry={processingEntry} role="reader" />);

    act(() => vi.advanceTimersByTime(PROCESSING_DELAY_WARNING_MS - 1_000));
    expect(screen.queryByText("Taking longer than usual")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("Taking longer than usual")).toBeInTheDocument();
  });

  it("restarts the two-minute window when a fresh heartbeat arrives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(processingEntry.processingHeartbeatAt!));
    const { rerender } = render(<EntryCard entry={processingEntry} role="reader" />);

    act(() => vi.advanceTimersByTime(PROCESSING_DELAY_WARNING_MS - 1_000));
    const freshHeartbeat = new Date(Date.now()).toISOString();
    rerender(
      <EntryCard
        entry={{ ...processingEntry, processingHeartbeatAt: freshHeartbeat }}
        role="reader"
      />,
    );

    act(() => vi.advanceTimersByTime(PROCESSING_DELAY_WARNING_MS - 1_000));
    expect(screen.queryByText("Taking longer than usual")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("Taking longer than usual")).toBeInTheDocument();
  });

  it("shows a safe timeout explanation and keeps Retry available to the owner", () => {
    render(
      <EntryCard
        entry={{
          ...processingEntry,
          status: "failed",
          errorCode: "PROCESSING_TIMEOUT",
          errorMessage: "Processing exceeded the 15 minute safety limit.",
        }}
        role="contributor"
        currentUserId={processingEntry.createdBy ?? undefined}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Processing exceeded the 15 minute safety limit.",
    );
    expect(
      screen.getByRole("button", { name: "Retry processing for Processing resilience" }),
    ).toBeEnabled();
  });

  it("never exposes an unclassified internal failure message", () => {
    render(
      <EntryCard
        entry={{
          ...processingEntry,
          status: "failed",
          errorCode: "PIPELINE_FAILED",
          errorMessage: "Authorization: Bearer private-token stack trace",
        }}
        role="reader"
      />,
    );

    expect(screen.queryByText(/private-token/i)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Processing could not be completed. Check the source and try again.",
    );
  });

  it("explains a terminal Gemini request timeout without technical details", () => {
    render(
      <EntryCard
        entry={{
          ...processingEntry,
          status: "failed",
          errorCode: "GEMINI_REQUEST_TIMEOUT",
          errorMessage: "Gemini did not respond within 120 seconds.",
        }}
        role="reader"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The AI service took too long to respond. Please retry this entry later.",
    );
  });
});
