"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SearchInput({ searchAction }: { searchAction: string }) {
  const searchParams = useSearchParams();
  const currentQuery = searchParams.get("q") ?? "";
  const preservedParameters = Array.from(searchParams.entries()).filter(
    ([name]) => name !== "q" && name !== "page",
  );
  const clearParameters = new URLSearchParams(preservedParameters);
  const clearHref = clearParameters.size
    ? `${searchAction}?${clearParameters.toString()}`
    : searchAction;

  return (
    <form
      action={searchAction}
      method="get"
      role="search"
      className="group flex h-[60px] w-full max-w-[900px] items-center rounded-[20px] border border-[#F4F7FE] bg-white px-4 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.06)] transition-[border-color,box-shadow] hover:border-primary/20 focus-within:border-primary/40 focus-within:shadow-lg sm:px-6"
    >
      {preservedParameters.map(([name, value], index) => (
        <input key={`${name}-${index}`} type="hidden" name={name} value={value} />
      ))}
      <Search
        aria-hidden="true"
        className="mr-3 shrink-0 text-[#A3AED0] transition-colors group-focus-within:text-primary sm:mr-4"
        size={22}
        strokeWidth={2.5}
      />
      <label htmlFor="dashboard-search" className="sr-only">
        Search entries
      </label>
      <input
        key={currentQuery}
        id="dashboard-search"
        name="q"
        type="search"
        defaultValue={currentQuery}
        placeholder="Search links, tools, and research"
        className="min-w-0 flex-1 bg-transparent text-[16px] font-bold text-[#1B254B] outline-none placeholder:text-[#A3AED0]/80"
      />
      {currentQuery ? (
        <Link
          href={clearHref}
          aria-label="Clear search"
          className="ml-2 rounded-full p-1.5 text-[#718096] transition-colors hover:bg-[#F4F7FE] hover:text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X aria-hidden="true" size={20} strokeWidth={2.5} />
        </Link>
      ) : null}
      <button
        type="submit"
        className="ml-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        Search
      </button>
    </form>
  );
}

export default function Navbar({ searchAction = "/dashboard" }: { searchAction?: string }) {
  return (
    <header className="sticky top-0 z-40 flex min-h-[96px] items-center justify-center bg-background/90 px-4 py-4 backdrop-blur-md sm:px-8">
      <Suspense
        fallback={
          <div
            aria-hidden="true"
            className="h-[60px] w-full max-w-[900px] animate-pulse rounded-[20px] border border-[#E2E8F0] bg-white shadow-sm"
          />
        }
      >
        <SearchInput searchAction={searchAction} />
      </Suspense>
    </header>
  );
}
