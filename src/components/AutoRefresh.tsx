"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { EntryStatus } from "./types";

export const PROCESSING_POLL_INTERVAL_MS = 15_000;

type UpdatedEntry = {
  id: string;
  status: EntryStatus;
};

export default function AutoRefresh({ activeEntryIds }: { activeEntryIds: string[] }) {
  const router = useRouter();
  const activeIdsKey = activeEntryIds.join(",");

  useEffect(() => {
    const activeIds = new Set(activeIdsKey.split(",").filter(Boolean));
    if (activeIds.size === 0) return;

    let pollingTimer: number | null = null;

    const stopPolling = () => {
      if (pollingTimer === null) return;
      window.clearInterval(pollingTimer);
      pollingTimer = null;
    };

    const startPolling = () => {
      stopPolling();
      if (document.visibilityState === "hidden") return;
      pollingTimer = window.setInterval(() => router.refresh(), PROCESSING_POLL_INTERVAL_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopPolling();
        return;
      }
      router.refresh();
      startPolling();
    };

    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel("entries-status-changes")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "entries",
        },
        (payload) => {
          const updatedEntry = payload.new as UpdatedEntry;
          if (activeIds.has(updatedEntry.id)) router.refresh();
        },
      )
      .subscribe();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    startPolling();

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [activeIdsKey, router]);

  return null;
}
