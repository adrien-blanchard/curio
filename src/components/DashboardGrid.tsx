"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import AutoRefresh from "./AutoRefresh";
import EntryCard from "./EntryCard";
import EntryModal from "./EntryModal";
import type { CurioEntry, CurioTag, UserRole } from "./types";

export type DashboardGridProps = {
  entries: CurioEntry[];
  allTags: CurioTag[];
  role: UserRole;
  currentUserId?: string;
};

export default function DashboardGrid({
  entries,
  allTags,
  role,
  currentUserId,
}: DashboardGridProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const selectedEntry = selectedEntryId
    ? (entries.find((entry) => entry.id === selectedEntryId) ?? null)
    : null;
  const activeEntryIds = useMemo(
    () =>
      entries
        .filter((entry) => entry.status !== "ready" && entry.status !== "failed")
        .map((entry) => entry.id),
    [entries],
  );
  const filterByAuthor = useCallback(
    (email: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page");
      params.set("author", email);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );
  const openEntry = useCallback((entry: CurioEntry) => setSelectedEntryId(entry.id), []);
  const closeEntry = useCallback(() => setSelectedEntryId(null), []);

  return (
    <section aria-label="Entries">
      {activeEntryIds.length ? <AutoRefresh activeEntryIds={activeEntryIds} /> : null}

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div
            aria-hidden="true"
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#E2E8F0] bg-white text-2xl shadow-soft"
          >
            🔎
          </div>
          <h2 className="text-lg font-bold text-[#1B254B]">No entries found</h2>
          <p className="mt-2 max-w-sm text-sm font-medium text-[#718096]">
            Adjust the server-side filters or submit a new source if your role allows it.
          </p>
        </div>
      ) : (
        <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-5 min-[840px]:grid-cols-2 2xl:grid-cols-3">
          {entries.map((entry, index) => (
            <EntryCard
              key={`${entry.id}:${entry.thumbnailUrl ?? ""}`}
              entry={entry}
              role={role}
              currentUserId={currentUserId}
              onOpenModal={openEntry}
              onAuthorFilter={filterByAuthor}
              eagerImage={index < 4}
            />
          ))}
        </div>
      )}

      {selectedEntry ? (
        <EntryModal
          entry={selectedEntry}
          allTags={allTags}
          role={role}
          currentUserId={currentUserId}
          onClose={closeEntry}
        />
      ) : null}
    </section>
  );
}
