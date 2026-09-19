"use client";

import Image from "next/image";
import SourceAgeBadge from "@/components/SourceAgeBadge";
import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { DemoEntry } from "@/lib/demo/data";
import { catalogCardStyles } from "@/lib/ui/catalog-card-styles";
import { getTintedTagStyle } from "@/lib/ui/tag-colors";

function DemoCard({ entry, eager = false }: { entry: DemoEntry; eager?: boolean }) {
  return (
    <article className={catalogCardStyles.card}>
      <div className={catalogCardStyles.media}>
        <Image
          src={entry.image}
          alt=""
          fill
          priority={eager}
          className={catalogCardStyles.image}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        />
        <span className={catalogCardStyles.sourceBadge}>{entry.source}</span>
      </div>
      <div className={catalogCardStyles.body}>
        <p className={`mb-2 ${catalogCardStyles.date}`}>
          {new Intl.DateTimeFormat("en", {
            dateStyle: "medium",
            timeZone: "UTC",
          }).format(new Date(`${entry.publishedAt}T00:00:00Z`))}
        </p>
        <h2 className={catalogCardStyles.title}>{entry.title}</h2>
        <div className="mt-2">
          <SourceAgeBadge date={entry.publishedAt} kind="published" />
        </div>
        <p className={catalogCardStyles.summary}>{entry.summary}</p>
        <div className="mt-auto flex flex-wrap gap-2 pt-5" aria-label="Tags">
          {entry.tags.map((tag) => (
            <span
              key={tag.name}
              className={catalogCardStyles.tag}
              style={getTintedTagStyle(tag.color)}
            >
              {tag.name}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

export default function DemoCatalog({ entries }: { entries: DemoEntry[] }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("en");
  const filteredEntries = useMemo(() => {
    if (!normalizedQuery) return entries;
    return entries.filter((entry) =>
      [entry.title, entry.summary, entry.source, ...entry.tags.map(({ name }) => name)]
        .join(" ")
        .toLocaleLowerCase("en")
        .includes(normalizedQuery),
    );
  }, [entries, normalizedQuery]);

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-slate-100/80 bg-[#F4F7FE]/90 px-5 py-5 backdrop-blur-xl sm:px-8">
        <label className="mx-auto flex h-14 max-w-3xl items-center rounded-2xl border border-slate-100 bg-white px-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)] focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-100">
          <span className="sr-only">Search the demo knowledge base</span>
          <Search aria-hidden="true" className="mr-3 text-slate-400" size={21} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the synthetic knowledge base"
            className="min-w-0 flex-1 bg-transparent text-base font-semibold text-[#1B254B] outline-none placeholder:text-slate-400"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <X aria-hidden="true" size={18} />
            </button>
          ) : null}
        </label>
      </div>

      <div className="mx-auto max-w-[1480px] px-5 py-10 sm:px-8 lg:px-12">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#0075c9]">
              Public demo
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-[#1B254B] sm:text-4xl">
              Explore a curated knowledge base
            </h1>
            <p className="mt-3 max-w-2xl text-sm font-medium leading-relaxed text-slate-500 sm:text-base">
              Every card below is synthetic. This page never connects to Supabase or exposes private
              submissions.
            </p>
          </div>
          <p className="text-sm font-bold text-slate-400" aria-live="polite">
            {filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"}
          </p>
        </div>

        {filteredEntries.length ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {filteredEntries.map((entry, index) => (
              <DemoCard key={entry.id} entry={entry} eager={index === 0} />
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-14 text-center">
            <h2 className="text-lg font-extrabold text-[#1B254B]">No matching entries</h2>
            <p className="mt-2 text-sm font-medium text-slate-500">
              Try a broader term or clear the search field.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
