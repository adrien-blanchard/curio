import "@testing-library/jest-dom/vitest";

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AutoRefresh, { PROCESSING_POLL_INTERVAL_MS } from "@/components/AutoRefresh";

const mocks = vi.hoisted(() => ({
  channel: vi.fn(),
  on: vi.fn(),
  refresh: vi.fn(),
  removeChannel: vi.fn(),
  subscribe: vi.fn(),
  realtimeHandler: null as ((payload: { new: { id: string; status: string } }) => void) | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  }),
}));

describe("AutoRefresh", () => {
  let visibilityState: DocumentVisibilityState;
  const channel = {
    on: mocks.on,
    subscribe: mocks.subscribe,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    visibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    mocks.on.mockImplementation(
      (
        _event: string,
        _filter: unknown,
        handler: (payload: { new: { id: string; status: string } }) => void,
      ) => {
        mocks.realtimeHandler = handler;
        return channel;
      },
    );
    mocks.subscribe.mockReturnValue(channel);
    mocks.channel.mockReturnValue(channel);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls every 15 seconds and still refreshes from Realtime", () => {
    render(<AutoRefresh activeEntryIds={["entry-a"]} />);

    act(() => vi.advanceTimersByTime(PROCESSING_POLL_INTERVAL_MS - 1));
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.refresh).toHaveBeenCalledOnce();

    act(() => mocks.realtimeHandler?.({ new: { id: "entry-a", status: "ready" } }));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);

    act(() => mocks.realtimeHandler?.({ new: { id: "another-entry", status: "ready" } }));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("pauses while hidden, refreshes on return, and cleans up every listener and timer", () => {
    const { unmount } = render(<AutoRefresh activeEntryIds={["entry-a"]} />);

    visibilityState = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(PROCESSING_POLL_INTERVAL_MS * 2));
    expect(mocks.refresh).not.toHaveBeenCalled();

    visibilityState = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(PROCESSING_POLL_INTERVAL_MS));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);

    unmount();
    expect(mocks.removeChannel).toHaveBeenCalledWith(channel);
    act(() => vi.advanceTimersByTime(PROCESSING_POLL_INTERVAL_MS * 2));
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });
});
