import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SOURCE_DATE_KINDS } from "@/lib/ui/source-age";

import DashboardGrid from "@/components/DashboardGrid";
import FilterBar from "@/components/FilterBar";
import SubmitLinkButton from "@/components/SubmitLinkButton";
import type { CurioEntry, CurioTag, EntryStatus, SourceType } from "@/components/types";
import type { FilterAuthor } from "@/components/FilterBar";
import { getTrustedAvatarUrl } from "@/lib/auth/avatar";
import { catalogAuthorEmailSchema } from "@/lib/auth/catalog-author";
import { requirePageActor } from "@/lib/auth/page";
import { dashboardTagSlugSchema, parseDashboardTagSlugs } from "@/lib/dashboard/filter-validation";
import { recoverStaleEntryProcessingBestEffort } from "@/lib/workflows/recovery";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 18;
const statusSchema = z.enum(["queued", "analyzing", "finalizing", "ready", "failed"]);
const sourceSchema = z.enum(["opensource", "proprietary"]);
const entryRowSchema = z.object({
  id: z.uuid(),
  url: z.url(),
  title: z.string().nullable(),
  tldr: z.string().nullable(),
  thumbnail_path: z.string().nullable(),
  status: statusSchema,
  source_type: sourceSchema,
  created_at: z.string(),
  created_by: z.uuid().nullable(),
  author_email: catalogAuthorEmailSchema.nullable(),
  author_display_name: z.string().nullable(),
  author_avatar_url: z.string().nullable(),
  processing_heartbeat_at: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable(),
  thumbnail_origin: z.enum(["automatic", "manual", "placeholder"]).nullable().optional(),
  total_count: z.coerce.number().int().nonnegative(),
});
const tagSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: dashboardTagSlugSchema,
  color: z.string(),
});
const authorRowSchema = z.object({
  author_email: catalogAuthorEmailSchema,
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  entry_count: z.coerce.number().int().nonnegative(),
});

type SearchParameters = Record<string, string | string[] | undefined>;

function firstParameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function positiveInteger(value: string, fallback: number): number {
  const number = Number.parseInt(value, 10);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function normalizedSearch(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function pageHref(parameters: SearchParameters, page: number): string {
  const output = new URLSearchParams();
  for (const [name, rawValue] of Object.entries(parameters)) {
    if (name === "page") continue;
    for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      if (value) output.append(name, value);
    }
  }
  if (page > 1) output.set("page", String(page));
  const query = output.toString();
  return query ? `/dashboard?${query}` : "/dashboard";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParameters>;
}) {
  const actor = await requirePageActor();
  await recoverStaleEntryProcessingBestEffort();
  const parameters = await searchParams;
  const page = positiveInteger(firstParameter(parameters.page), 1);
  if (page > 10_000) {
    redirect(pageHref(parameters, 1));
  }
  const query = normalizedSearch(firstParameter(parameters.q));
  const source = sourceSchema.safeParse(firstParameter(parameters.source));
  const sortAscending = firstParameter(parameters.sort) === "asc";
  const requestedAuthor = catalogAuthorEmailSchema.safeParse(firstParameter(parameters.author));
  const authorEmail = requestedAuthor.success ? requestedAuthor.data : "";
  const selectedSlugs = parseDashboardTagSlugs(firstParameter(parameters.tags));

  const [tagsResult, authorsResult] = await Promise.all([
    actor.supabase
      .from("tags")
      .select("id, name, slug, color")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    actor.supabase.rpc("list_entry_authors"),
  ]);
  if (tagsResult.error) throw new Error("Unable to load the organization taxonomy.");
  if (authorsResult.error) throw new Error("Unable to load dashboard authors.");

  const tags = z.array(tagSchema).parse(tagsResult.data ?? []);
  const authors: FilterAuthor[] = z
    .array(authorRowSchema)
    .parse(authorsResult.data ?? [])
    .map((author) => ({
      value: author.author_email,
      email: author.author_email,
      label: author.display_name?.trim() || author.author_email,
      displayName: author.display_name,
      avatarUrl: getTrustedAvatarUrl(author.avatar_url),
    }));
  let entries: CurioEntry[] = [];
  let total = 0;
  if (page <= 10_000) {
    const start = (page - 1) * PAGE_SIZE;
    const { data, error } = await actor.supabase.rpc("list_entries_page", {
      p_query: query || null,
      p_source_type: source.success ? source.data : null,
      p_tag_slugs: selectedSlugs,
      p_sort_ascending: sortAscending,
      p_offset: start,
      p_limit: PAGE_SIZE,
      p_author_email: authorEmail || null,
    });
    if (error) throw new Error("Unable to load dashboard entries.");

    const rows = z.array(entryRowSchema).parse(data ?? []);
    if (page > 1 && rows.length === 0) {
      redirect(pageHref(parameters, 1));
    }
    total = rows[0]?.total_count ?? 0;
    const entryIds = rows.map((entry) => entry.id);
    const sourceDatesResult = entryIds.length
      ? await actor.supabase
          .from("entries")
          .select("id, source_published_at, source_date_kind, source_date_origin")
          .in("id", entryIds)
      : { data: [], error: null };
    if (sourceDatesResult.error) throw new Error("Unable to load source dates.");
    const sourceDates = new Map(
      z
        .array(
          z.object({
            id: z.uuid(),
            source_published_at: z.string().nullable(),
            source_date_kind: z.enum(SOURCE_DATE_KINDS).nullable(),
            source_date_origin: z.enum(["ai", "manual"]).nullable(),
          }),
        )
        .parse(sourceDatesResult.data ?? [])
        .map((row) => [row.id, row]),
    );
    const thumbnailPaths = rows
      .filter((entry) => entry.thumbnail_origin !== "placeholder")
      .map((entry) => entry.thumbnail_path)
      .filter((path): path is string => Boolean(path));

    const [relationsResult, thumbnailsResult] = await Promise.all([
      entryIds.length
        ? actor.supabase.from("entry_tags").select("entry_id, tag_id").in("entry_id", entryIds)
        : Promise.resolve({ data: [], error: null }),
      thumbnailPaths.length
        ? actor.supabase.storage.from("thumbnails").createSignedUrls(thumbnailPaths, 15 * 60)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (relationsResult.error || thumbnailsResult.error) {
      throw new Error("Unable to load dashboard entry metadata.");
    }

    const tagById = new Map(tags.map((tag) => [tag.id, tag]));
    const tagsByEntry = new Map<string, CurioTag[]>();
    for (const relation of relationsResult.data ?? []) {
      const tag = tagById.get(relation.tag_id);
      if (!tag) continue;
      const current = tagsByEntry.get(relation.entry_id) ?? [];
      current.push(tag);
      tagsByEntry.set(relation.entry_id, current);
    }
    const signedUrlByPath = new Map(
      (thumbnailsResult.data ?? []).map((thumbnail) => [thumbnail.path, thumbnail.signedUrl]),
    );

    entries = rows.map((entry) => ({
      id: entry.id,
      title: entry.title,
      url: entry.url,
      tldr: entry.tldr,
      thumbnailUrl:
        entry.thumbnail_origin !== "placeholder" && entry.thumbnail_path
          ? (signedUrlByPath.get(entry.thumbnail_path) ?? null)
          : null,
      status: entry.status as EntryStatus,
      sourceType: entry.source_type as SourceType,
      tags: tagsByEntry.get(entry.id) ?? [],
      createdAt: entry.created_at,
      sourcePublishedAt: sourceDates.get(entry.id)?.source_published_at ?? null,
      sourceDateKind: sourceDates.get(entry.id)?.source_date_kind ?? null,
      sourceDateOrigin: sourceDates.get(entry.id)?.source_date_origin ?? null,
      createdBy: entry.created_by,
      authorEmail: entry.author_email,
      authorDisplayName: entry.author_display_name,
      authorAvatarUrl: getTrustedAvatarUrl(entry.author_avatar_url),
      processingHeartbeatAt: entry.processing_heartbeat_at ?? null,
      errorCode: entry.error_code ?? null,
      errorMessage: entry.error_message,
      thumbnailOrigin: entry.thumbnail_origin ?? null,
    }));
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="relative z-20 mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[32px] font-extrabold leading-tight tracking-tight text-[#1B254B]">
            Knowledge base
          </h1>
          <p className="mt-1 text-[15px] font-medium text-[#718096]">
            Review the technical resources shared by your organization.
          </p>
        </div>
        <SubmitLinkButton role={actor.role} />
      </div>

      <FilterBar
        allTags={tags}
        uniqueAuthors={authors}
        currentSource={source.success ? source.data : ""}
        currentAuthor={authorEmail}
        currentSort={sortAscending ? "asc" : ""}
        currentTags={selectedSlugs}
      />

      <DashboardGrid
        entries={entries}
        allTags={tags}
        role={actor.role}
        currentUserId={actor.user.id}
      />

      {pageCount > 1 ? (
        <nav
          aria-label="Dashboard pagination"
          className="flex items-center justify-center gap-3 pt-4"
        >
          {page > 1 ? (
            <Link
              href={pageHref(parameters, page - 1)}
              className="rounded-xl border border-border bg-white px-4 py-2 text-sm font-bold text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Previous
            </Link>
          ) : null}
          <span className="text-sm font-medium text-[#718096]">
            Page {Math.min(page, pageCount)} of {pageCount}
          </span>
          {page < pageCount ? (
            <Link
              href={pageHref(parameters, page + 1)}
              className="rounded-xl border border-border bg-white px-4 py-2 text-sm font-bold text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
