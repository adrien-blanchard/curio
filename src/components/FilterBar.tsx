"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Filter, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import CustomSelect from "./CustomSelect";
import type { CurioTag, SourceType } from "./types";
import { MAX_DASHBOARD_TAG_FILTERS } from "@/lib/dashboard/filter-constants";
import { getWhiteTextTagStyle } from "@/lib/ui/tag-colors";

export type FilterAuthor = {
  value: string;
  label: string;
  email?: string;
  avatarUrl?: string | null;
  displayName?: string | null;
};

type FilterBarProps = {
  allTags: CurioTag[];
  uniqueAuthors?: FilterAuthor[];
  currentSource?: SourceType | "";
  currentAuthor?: string;
  currentSort?: "" | "asc";
  currentTags?: string[];
};

type OptimisticTagFilters = {
  selected: string[];
  lastIncomingKey: string;
  latestPendingKey: string | null;
  pendingKeys: string[];
};

function reconcileTagFilters(
  state: OptimisticTagFilters,
  incomingTags: string[],
  incomingKey: string,
): OptimisticTagFilters {
  if (state.lastIncomingKey === incomingKey) return state;

  if (
    state.latestPendingKey !== null &&
    incomingKey !== state.latestPendingKey &&
    state.pendingKeys.includes(incomingKey)
  ) {
    return { ...state, lastIncomingKey: incomingKey };
  }

  return {
    selected: incomingTags,
    lastIncomingKey: incomingKey,
    latestPendingKey: null,
    pendingKeys: [],
  };
}

function getTagFilterStatus(selectedCount: number) {
  if (selectedCount >= MAX_DASHBOARD_TAG_FILTERS) {
    return `${selectedCount} of ${MAX_DASHBOARD_TAG_FILTERS} selected. Limit reached; remove one to choose another.`;
  }

  return `${selectedCount} of ${MAX_DASHBOARD_TAG_FILTERS} selected. Select up to ${MAX_DASHBOARD_TAG_FILTERS} tags.`;
}

function TagFilterButton({
  tag,
  isActive,
  onClick,
  className = "",
  showCheck = false,
  disabled = false,
  describedBy,
}: {
  tag: CurioTag;
  isActive: boolean;
  onClick: () => void;
  className?: string;
  showCheck?: boolean;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      aria-describedby={describedBy}
      disabled={disabled}
      className={`${className} min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border px-5 py-2 text-sm font-bold transition-[background-color,border-color,box-shadow,color,filter,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98] ${
        isActive
          ? "text-white shadow-md hover:brightness-90"
          : "border-slate-200 bg-white text-[#1B254B] shadow-sm hover:border-primary/40 hover:shadow-md"
      } disabled:cursor-not-allowed disabled:opacity-45`}
      style={isActive ? getWhiteTextTagStyle(tag.color) : undefined}
      title={disabled ? `Remove a selected tag before adding ${tag.name}` : tag.name}
    >
      <span className="truncate">{tag.name}</span>
      {showCheck && isActive ? (
        <Check aria-hidden="true" className="shrink-0" size={15} strokeWidth={3} />
      ) : null}
    </button>
  );
}

export default function FilterBar({
  allTags,
  uniqueAuthors = [],
  currentSource = "",
  currentAuthor = "",
  currentSort = "",
  currentTags = [],
}: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tagPickerRef = useRef<HTMLDivElement>(null);
  const tagPickerPanelRef = useRef<HTMLDivElement>(null);
  const tagPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const tagPickerCloseRef = useRef<HTMLButtonElement>(null);
  const incomingTagKey = currentTags.join(",");
  const incomingTagSlugs = incomingTagKey ? incomingTagKey.split(",") : [];
  const [isTagPickerOpen, setIsTagPickerOpen] = useState(false);
  const [optimisticTagFilters, setOptimisticTagFilters] = useState<OptimisticTagFilters>(() => ({
    selected: incomingTagSlugs,
    lastIncomingKey: incomingTagKey,
    latestPendingKey: null,
    pendingKeys: [],
  }));
  const reconciledTagFilters = reconcileTagFilters(
    optimisticTagFilters,
    incomingTagSlugs,
    incomingTagKey,
  );
  if (reconciledTagFilters !== optimisticTagFilters) {
    setOptimisticTagFilters(reconciledTagFilters);
  }
  const selectedTagSlugs = reconciledTagFilters.selected;

  const closeTagPicker = (returnFocus = false) => {
    setIsTagPickerOpen(false);
    if (returnFocus) tagPickerTriggerRef.current?.focus();
  };

  useEffect(() => {
    if (!isTagPickerOpen) return;

    tagPickerCloseRef.current?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (tagPickerRef.current?.contains(event.target as Node)) return;
      setIsTagPickerOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setIsTagPickerOpen(false);
        tagPickerTriggerRef.current?.focus();
        return;
      }

      if (event.key !== "Tab") return;
      const panel = tagPickerPanelRef.current;
      if (!panel) return;
      const focusableElements = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements.at(-1);
      if (!firstFocusable || !lastFocusable) return;

      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTagPickerOpen]);

  const navigateWith = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page");
      Object.entries(updates).forEach(([name, value]) => {
        if (value) params.set(name, value);
        else params.delete(name);
      });
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const applyTagFilters = (nextTags: string[]) => {
    const previousKey = selectedTagSlugs.join(",");
    const nextKey = nextTags.join(",");
    if (nextKey === previousKey) return;
    setOptimisticTagFilters({
      ...reconciledTagFilters,
      selected: nextTags,
      latestPendingKey: nextKey,
      pendingKeys: [...new Set([...reconciledTagFilters.pendingKeys, previousKey, nextKey])],
    });
    navigateWith({ tags: nextTags.length ? nextTags.join(",") : null });
  };

  const toggleTag = (slug: string) => {
    const activeTags = selectedTagSlugs;
    if (!activeTags.includes(slug) && activeTags.length >= MAX_DASHBOARD_TAG_FILTERS) return;
    const nextTags = activeTags.includes(slug)
      ? activeTags.filter((tag) => tag !== slug)
      : [...activeTags, slug];
    applyTagFilters(nextTags);
  };

  return (
    <section aria-label="Entry filters" className="relative z-30 my-4 space-y-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="hidden h-[40px] items-center gap-2 pr-2 md:flex">
          <Filter aria-hidden="true" className="text-[#718096]" size={16} />
          <span className="text-[14px] font-extrabold uppercase tracking-wider text-[#1B254B]">
            Filters
          </span>
        </div>

        <CustomSelect
          label="Source"
          value={currentSource}
          onChange={(value) => navigateWith({ source: value || null })}
          options={[
            { label: "All", value: "" },
            { label: "Open source", value: "opensource" },
            { label: "Proprietary", value: "proprietary" },
          ]}
          triggerClassName="rounded-full"
          className="w-auto"
        />

        {uniqueAuthors.length ? (
          <CustomSelect
            label="Author"
            value={currentAuthor}
            onChange={(value) => navigateWith({ author: value || null })}
            options={[
              { label: "All users", value: "" },
              ...uniqueAuthors.map((author) => ({
                label: author.label,
                value: author.value,
                description:
                  author.email && author.label !== author.email ? author.email : undefined,
                avatarEmail: author.email ?? author.value,
                avatarUrl: author.avatarUrl,
                avatarDisplayName: author.displayName,
              })),
            ]}
            showSearch={uniqueAuthors.length > 6}
            triggerClassName="rounded-full"
            className="w-auto max-w-[280px]"
          />
        ) : null}

        <CustomSelect
          label="Sort"
          value={currentSort}
          onChange={(value) => navigateWith({ sort: value || null })}
          options={[
            { label: "Newest", value: "" },
            { label: "Oldest", value: "asc" },
          ]}
          triggerClassName="rounded-full"
          dropdownAlign="end"
          className="ml-auto w-auto"
        />
      </div>

      {allTags.length || selectedTagSlugs.length ? (
        <div ref={tagPickerRef} className="relative">
          <div className="hidden md:block">
            <p id="desktop-tag-filter-count" role="status" className="sr-only">
              {getTagFilterStatus(selectedTagSlugs.length)}
            </p>

            <div
              role="group"
              aria-label="Tag filters"
              aria-describedby="desktop-tag-filter-count"
              className="flex flex-wrap items-center gap-2"
            >
              {allTags.map((tag) => {
                const isActive = selectedTagSlugs.includes(tag.slug);
                const isDisabled =
                  !isActive && selectedTagSlugs.length >= MAX_DASHBOARD_TAG_FILTERS;
                return (
                  <TagFilterButton
                    key={`desktop-${tag.id}`}
                    tag={tag}
                    isActive={isActive}
                    onClick={() => toggleTag(tag.slug)}
                    className="inline-flex max-w-52 md:px-4 md:py-1.5"
                    disabled={isDisabled}
                    describedBy={isDisabled ? "desktop-tag-filter-count" : undefined}
                  />
                );
              })}
              {selectedTagSlugs.length ? (
                <button
                  type="button"
                  onClick={() => applyTagFilters([])}
                  className="ml-1 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-bold text-slate-500 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>

          <div className="md:hidden">
            <button
              ref={tagPickerTriggerRef}
              type="button"
              onClick={() => {
                if (isTagPickerOpen) closeTagPicker();
                else setIsTagPickerOpen(true);
              }}
              aria-label={`Tags, ${selectedTagSlugs.length} selected`}
              aria-haspopup="dialog"
              aria-expanded={isTagPickerOpen}
              aria-controls={isTagPickerOpen ? "mobile-tags-panel" : undefined}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold shadow-sm transition-[background-color,border-color,box-shadow,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                isTagPickerOpen
                  ? "border-primary/40 bg-blue-50 text-primary shadow-md"
                  : "border-slate-200 bg-white text-[#1B254B] hover:border-primary/30 hover:shadow-md"
              }`}
            >
              <span>Tags</span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="text-xs font-semibold text-slate-500">
                {selectedTagSlugs.length} selected
              </span>
              <ChevronDown
                aria-hidden="true"
                size={16}
                strokeWidth={2.5}
                className={`text-slate-400 transition-transform ${
                  isTagPickerOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {isTagPickerOpen ? (
              <div
                ref={tagPickerPanelRef}
                id="mobile-tags-panel"
                role="dialog"
                aria-modal="false"
                aria-labelledby="mobile-tags-title"
                className="absolute inset-x-0 top-full z-50 mt-2 flex max-h-[70vh] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_60px_-22px_rgba(15,23,42,0.35)]"
              >
                <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3">
                  <h2 id="mobile-tags-title" className="text-sm font-extrabold text-[#1B254B]">
                    Tags
                  </h2>
                  <div className="flex items-center gap-2">
                    {selectedTagSlugs.length ? (
                      <button
                        type="button"
                        onClick={() => {
                          applyTagFilters([]);
                          tagPickerCloseRef.current?.focus();
                        }}
                        className="rounded px-1 py-0.5 text-xs font-bold text-slate-500 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        Clear filters
                      </button>
                    ) : null}
                    <button
                      ref={tagPickerCloseRef}
                      type="button"
                      onClick={() => closeTagPicker(true)}
                      aria-label="Close tags"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <X aria-hidden="true" size={17} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>

                <p id="mobile-tag-filter-count" role="status" className="sr-only">
                  {getTagFilterStatus(selectedTagSlugs.length)}
                </p>

                <div className="min-h-0 overflow-y-auto p-4">
                  {allTags.length ? (
                    <div
                      role="group"
                      aria-label="Mobile tag filters"
                      aria-describedby="mobile-tag-filter-count"
                      className="flex flex-wrap gap-2"
                    >
                      {allTags.map((tag) => {
                        const isActive = selectedTagSlugs.includes(tag.slug);
                        const isDisabled =
                          !isActive && selectedTagSlugs.length >= MAX_DASHBOARD_TAG_FILTERS;
                        return (
                          <TagFilterButton
                            key={`mobile-${tag.id}`}
                            tag={tag}
                            isActive={isActive}
                            onClick={() => toggleTag(tag.slug)}
                            className="inline-flex max-w-full"
                            showCheck
                            disabled={isDisabled}
                            describedBy={isDisabled ? "mobile-tag-filter-count" : undefined}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <p className="py-2 text-sm font-medium text-slate-500">No tags available.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
