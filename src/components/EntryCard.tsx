"use client";
import SourceAgeBadge from "./SourceAgeBadge";

import { memo, useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import AuthorAvatar, { getAuthorDetails } from "./AuthorAvatar";
import { getRequestErrorMessage, readApiEnvelope } from "./api-envelope";
import {
  canManageEntry,
  type CurioEntry,
  type CurioTag,
  type EntryStatus,
  type UserRole,
} from "./types";
import { catalogCardStyles } from "@/lib/ui/catalog-card-styles";
import { getEntryPlaceholderImage } from "@/lib/ui/entry-placeholders";
import { getTintedTagStyle } from "@/lib/ui/tag-colors";
import { fetchWithTimeout } from "@/lib/http/fetch-with-timeout";
import { getSafeProcessingErrorMessage, useProcessingDelay } from "./processing-state";

export type EntryType = CurioEntry;

type RetryResponse = {
  id: string;
  status: EntryStatus;
};

type EntryCardProps = {
  entry: CurioEntry;
  role: UserRole;
  currentUserId?: string;
  onOpenModal?: (entry: CurioEntry) => void;
  onAuthorFilter?: (email: string) => void;
  eagerImage?: boolean;
};

const statusLabels: Record<Exclude<EntryStatus, "ready">, string> = {
  queued: "Queued",
  analyzing: "Analyzing",
  finalizing: "Finalizing",
  failed: "Failed",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

type EntryTagListProps = {
  entryTitle: string;
  tags: CurioTag[];
};

function EntryTagList({ entryTitle, tags }: EntryTagListProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const popoverTitleId = `${popoverId}-title`;
  const visibleTags = tags.slice(0, 3);
  const hiddenTagCount = Math.max(0, tags.length - visibleTags.length);

  useEffect(() => {
    if (!isOpen) return;

    popoverRef.current?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const closeAndRestoreFocus = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-1.5">
      <ul aria-label="Tags" className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5">
        {visibleTags.map((tag) => (
          <li
            key={tag.id}
            className={`${catalogCardStyles.tag} min-w-0 truncate`}
            style={getTintedTagStyle(tag.color)}
            title={tag.name}
          >
            {tag.name}
          </li>
        ))}
      </ul>

      {hiddenTagCount ? (
        <button
          ref={triggerRef}
          type="button"
          aria-controls={popoverId}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label={`Show all ${tags.length} tags for ${entryTitle}`}
          title={`Show ${hiddenTagCount} more ${hiddenTagCount === 1 ? "tag" : "tags"}`}
          onClick={(event) => {
            event.stopPropagation();
            setIsOpen((current) => !current);
          }}
          className="relative z-20 inline-flex h-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 px-2 text-xs font-extrabold text-slate-600 shadow-sm transition-[background-color,color,box-shadow] hover:bg-blue-100 hover:text-primary hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
        >
          +{hiddenTagCount}
        </button>
      ) : null}

      {isOpen ? (
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-labelledby={popoverTitleId}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
          className="absolute bottom-full left-0 z-40 mb-2 w-full min-w-52 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_16px_45px_rgba(15,23,42,0.18)] focus:outline-none"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <p id={popoverTitleId} className="text-xs font-extrabold text-[#1B254B]">
              All tags
            </p>
            <button
              type="button"
              onClick={closeAndRestoreFocus}
              aria-label="Close all tags"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
          <ul
            aria-label={`All tags for ${entryTitle}`}
            className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto"
          >
            {tags.map((tag) => (
              <li
                key={tag.id}
                className={catalogCardStyles.tag}
                style={getTintedTagStyle(tag.color)}
              >
                {tag.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function EntryCard({
  entry,
  role,
  currentUserId,
  onOpenModal,
  onAuthorFilter,
  eagerImage = false,
}: EntryCardProps) {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const isProcessing =
    entry.status === "queued" || entry.status === "analyzing" || entry.status === "finalizing";
  const isFailed = entry.status === "failed";
  const isProcessingDelayed = useProcessingDelay(entry);
  const processingError = getSafeProcessingErrorMessage(entry);
  const visibleStatus = entry.status === "ready" ? null : entry.status;
  const canRetry = canManageEntry(role, currentUserId, entry.createdBy);
  const canRetryFromCard = canRetry && isFailed;
  const author = entry.authorEmail
    ? getAuthorDetails(entry.authorEmail, entry.authorDisplayName)
    : null;
  const placeholderImage = getEntryPlaceholderImage(entry.id);
  const isUsingPlaceholder =
    entry.thumbnailOrigin === "placeholder" || !entry.thumbnailUrl || imageFailed;
  const imageSource =
    entry.thumbnailOrigin !== "placeholder" && entry.thumbnailUrl && !imageFailed
      ? entry.thumbnailUrl
      : placeholderImage;
  const entryTitle = entry.title ?? "Untitled entry";

  const handleRetry = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setIsRetrying(true);
    setRetryError(null);

    try {
      const response = await fetchWithTimeout(
        `/api/v1/entries/${encodeURIComponent(entry.id)}/retry`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
        },
        {
          timeoutMessage: "Retrying took too long. Check your connection and try again.",
        },
      );
      const envelope = await readApiEnvelope<RetryResponse>(response);
      if (!response.ok || envelope.error || !envelope.data) {
        throw new Error(
          getRequestErrorMessage(response, envelope.error, "This entry could not be retried."),
        );
      }
      router.refresh();
    } catch (error: unknown) {
      setRetryError(error instanceof Error ? error.message : "This entry could not be retried.");
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <article className={catalogCardStyles.card}>
      <button
        type="button"
        onClick={() => onOpenModal?.(entry)}
        disabled={!onOpenModal}
        aria-label={`View ${entryTitle}`}
        className="absolute inset-0 z-10 cursor-pointer rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset disabled:pointer-events-none"
      />

      <div className={catalogCardStyles.media}>
        {/* Runtime thumbnail hosts are deployment-restricted; fallbacks are bundled locally. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSource}
          alt=""
          className={catalogCardStyles.image}
          loading={eagerImage ? "eager" : "lazy"}
          decoding="async"
          onError={() => setImageFailed(true)}
        />

        <span className={`pointer-events-none z-20 ${catalogCardStyles.sourceBadge}`}>
          {entry.sourceType === "opensource" ? "Open source" : "Proprietary"}
        </span>

        {isUsingPlaceholder ? (
          <span className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg bg-white/65 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-700 shadow-sm ring-1 ring-white/70 backdrop-blur-md">
            No preview
          </span>
        ) : null}

        {visibleStatus ? (
          <span
            className={`pointer-events-none absolute bottom-4 left-4 z-20 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.13em] backdrop-blur sm:bottom-auto sm:left-auto sm:right-4 sm:top-4 ${
              isFailed ? "bg-red-950/75 text-white" : "bg-white text-primary"
            }`}
          >
            {isProcessing ? (
              <Loader2
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
                size={12}
              />
            ) : null}
            {isFailed ? <AlertTriangle aria-hidden="true" size={12} /> : null}
            {statusLabels[visibleStatus]}
          </span>
        ) : null}

        {canRetryFromCard ? (
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            aria-label={`Retry processing for ${entryTitle}`}
            title="Retry processing"
            className="absolute bottom-4 right-4 z-20 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/95 text-primary shadow-md backdrop-blur transition hover:bg-white hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          >
            {isRetrying ? (
              <Loader2
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
                size={16}
              />
            ) : (
              <RefreshCw aria-hidden="true" size={16} />
            )}
          </button>
        ) : null}

        {retryError ? (
          <span
            role="alert"
            className="pointer-events-none absolute bottom-16 left-4 right-4 z-20 rounded-lg bg-red-950/80 px-2.5 py-1.5 text-[10px] font-bold text-white backdrop-blur sm:bottom-4 sm:right-auto sm:max-w-[calc(100%-5rem)]"
          >
            {retryError}
          </span>
        ) : null}
      </div>

      <div className={catalogCardStyles.body}>
        <div className="mb-2 flex min-h-6 items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <time
              title="Added to Curio"
              className={catalogCardStyles.date}
              dateTime={entry.createdAt}
            >
              {formatDate(entry.createdAt)}
            </time>
            {entry.status === "ready" ? (
              <SourceAgeBadge date={entry.sourcePublishedAt} kind={entry.sourceDateKind} />
            ) : null}
          </div>
          {entry.authorEmail ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAuthorFilter?.(entry.authorEmail ?? "");
              }}
              disabled={!onAuthorFilter}
              aria-label={`Filter by author ${author?.displayName ?? entry.authorEmail} (${entry.authorEmail})`}
              title={`${author?.displayName ?? entry.authorEmail} — ${entry.authorEmail}`}
              className="relative z-20 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none motion-reduce:transform-none motion-reduce:transition-none"
            >
              <AuthorAvatar
                email={entry.authorEmail}
                displayName={entry.authorDisplayName}
                src={entry.authorAvatarUrl}
                size={24}
              />
            </button>
          ) : null}
        </div>

        <h3 className={catalogCardStyles.title}>{entryTitle}</h3>
        <p className={catalogCardStyles.summary}>
          {entry.tldr ??
            (isProcessing ? "Curio is preparing this entry." : "No summary is available.")}
        </p>

        {isProcessingDelayed ? (
          <p
            role="status"
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 ring-1 ring-inset ring-amber-200"
          >
            <AlertTriangle aria-hidden="true" size={14} />
            Taking longer than usual
          </p>
        ) : null}

        {processingError ? (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold leading-relaxed text-red-800 ring-1 ring-inset ring-red-200"
          >
            {processingError}
          </p>
        ) : null}

        <div className="mt-auto flex min-h-10 items-end justify-between gap-3 pt-5">
          {entry.tags.length ? (
            <EntryTagList entryTitle={entryTitle} tags={entry.tags} />
          ) : (
            <span />
          )}

          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open original: ${entryTitle}`}
            title="Open original"
            className="relative z-20 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-primary shadow-sm ring-1 ring-blue-100 transition-[background-color,color,box-shadow,transform] hover:-translate-y-0.5 hover:bg-primary hover:text-white hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 motion-reduce:transform-none"
          >
            <ExternalLink aria-hidden="true" size={17} />
          </a>
        </div>
      </div>
    </article>
  );
}

export default memo(EntryCard);
