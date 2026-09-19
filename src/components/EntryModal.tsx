"use client";
import SourceAgeBadge from "./SourceAgeBadge";
import { isValidSourceDate, SOURCE_DATE_LABELS, type SourceDateKind } from "@/lib/ui/source-age";

import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ExternalLink,
  ImageUp,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import AuthorAvatar, { getAuthorDetails } from "./AuthorAvatar";
import CustomSelect, { type SelectOption } from "./CustomSelect";
import Dialog from "./Dialog";
import { getRequestErrorMessage, readApiEnvelope } from "./api-envelope";
import {
  canManageEntry,
  type CurioEntry,
  type CurioTag,
  type EntryStatus,
  type SourceType,
  type ThumbnailOrigin,
  type UserRole,
} from "./types";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  fetchWithTimeout,
  RequestTimeoutError,
  THUMBNAIL_PREPARATION_TIMEOUT_MS,
  THUMBNAIL_UPLOAD_TIMEOUT_MS,
  withTimeout,
} from "@/lib/http/fetch-with-timeout";
import { catalogCardStyles } from "@/lib/ui/catalog-card-styles";
import { getEntryPlaceholderImage } from "@/lib/ui/entry-placeholders";
import { getTintedTagStyle } from "@/lib/ui/tag-colors";
import { getSafeProcessingErrorMessage, useProcessingDelay } from "./processing-state";

const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const MAX_ENTRY_TAGS = 10;
const ACCEPTED_THUMBNAIL_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const SOURCE_TYPE_OPTIONS = [
  {
    label: "Open source",
    value: "opensource",
    description: "Source code or materials are publicly available.",
  },
  {
    label: "Proprietary",
    value: "proprietary",
    description: "Access or usage is restricted by its owner.",
  },
] satisfies SelectOption[];

type ThumbnailResponse = {
  id: string;
  thumbnailUrl: string;
};

type ThumbnailUploadPreparation = {
  upload: {
    bucket: "thumbnail_uploads";
    path: string;
    token: string;
    contentType: "image/jpeg" | "image/png" | "image/webp";
    maximumBytes: number;
  };
};

type UpdateEntryResponse = {
  id: string;
  title: string;
  tldr: string;
  sourceType: SourceType;
};

type RetryResponse = {
  id: string;
  status: EntryStatus;
};

type ActiveOperation = "save" | "retry" | "upload" | "delete";

const operationAnnouncements: Record<ActiveOperation, string> = {
  save: "Saving entry changes.",
  retry: "Retrying entry processing.",
  upload: "Uploading and validating the thumbnail.",
  delete: "Deleting the entry.",
};

const statusLabels: Record<Exclude<EntryStatus, "ready">, string> = {
  queued: "Queued",
  analyzing: "Analyzing",
  finalizing: "Finalizing",
  failed: "Failed",
};

type EntryModalProps = {
  entry: CurioEntry;
  /** Complete organization taxonomy; entry tags are a safe fallback for isolated renders. */
  allTags?: CurioTag[];
  role: UserRole;
  currentUserId?: string;
  onClose: () => void;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  })
    .format(date)
    .toUpperCase();
}

export default function EntryModal({
  entry,
  allTags = entry.tags,
  role,
  currentUserId,
  onClose,
}: EntryModalProps) {
  const router = useRouter();
  const managementPanelId = useId();
  const managementHeadingId = `${managementPanelId}-heading`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const manageButtonRef = useRef<HTMLButtonElement>(null);
  const managementHeadingRef = useRef<HTMLHeadingElement>(null);
  const hasOpenedManagement = useRef(false);
  const activeOperationRef = useRef<ActiveOperation | null>(null);
  const retryProgressObservedRef = useRef(false);
  const [isManaging, setIsManaging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [currentThumbnailUrl, setCurrentThumbnailUrl] = useState(entry.thumbnailUrl);
  const [currentThumbnailOrigin, setCurrentThumbnailOrigin] = useState<ThumbnailOrigin | null>(
    entry.thumbnailOrigin ?? null,
  );
  const [failedThumbnailUrl, setFailedThumbnailUrl] = useState<string | null>(null);
  const [activeOperation, setActiveOperation] = useState<ActiveOperation | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const canManage = canManageEntry(role, currentUserId, entry.createdBy);
  const canEditEntry = canManage && (entry.status === "ready" || entry.status === "failed");
  const canRetry = canManage && entry.status === "failed";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [retryStatus, setRetryStatus] = useState<string | null>(null);
  const [retrySucceeded, setRetrySucceeded] = useState(false);
  const [title, setTitle] = useState(entry.title ?? "");
  const [tldr, setTldr] = useState(entry.tldr ?? "");
  const [sourceType, setSourceType] = useState<SourceType>(entry.sourceType);
  const [sourceDate, setSourceDate] = useState(entry.sourcePublishedAt ?? "");
  const [sourceDateKind, setSourceDateKind] = useState<SourceDateKind>(
    entry.sourceDateKind ?? "published",
  );
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(() =>
    entry.tags.map((tag) => tag.id),
  );

  const placeholderImage = getEntryPlaceholderImage(entry.id);
  const isUsingPlaceholder =
    currentThumbnailOrigin === "placeholder" ||
    !currentThumbnailUrl ||
    failedThumbnailUrl === currentThumbnailUrl;
  const storedThumbnailUrl =
    currentThumbnailOrigin !== "placeholder" &&
    currentThumbnailUrl &&
    failedThumbnailUrl !== currentThumbnailUrl
      ? currentThumbnailUrl
      : placeholderImage;
  const displayedThumbnailUrl = previewUrl ?? storedThumbnailUrl;
  const entryTitle = entry.title ?? "Untitled entry";
  const isBusy = activeOperation !== null;
  const visibleStatus = entry.status === "ready" ? null : entry.status;
  const isProcessing =
    entry.status === "queued" || entry.status === "analyzing" || entry.status === "finalizing";
  const isProcessingDelayed = useProcessingDelay(entry);
  const processingError = getSafeProcessingErrorMessage(entry);

  const beginOperation = (operation: ActiveOperation): boolean => {
    if (activeOperationRef.current) return false;
    activeOperationRef.current = operation;
    setActiveOperation(operation);
    return true;
  };

  const finishOperation = (operation: ActiveOperation) => {
    if (activeOperationRef.current !== operation) return;
    activeOperationRef.current = null;
    setActiveOperation(null);
  };

  const handleRequestClose = useCallback(() => {
    if (activeOperationRef.current) return;
    onClose();
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    setCurrentThumbnailUrl(entry.thumbnailUrl);
    setCurrentThumbnailOrigin(entry.thumbnailOrigin ?? null);
    setFailedThumbnailUrl(null);
  }, [entry.id, entry.thumbnailOrigin, entry.thumbnailUrl]);

  useEffect(() => {
    if (!retrySucceeded) {
      retryProgressObservedRef.current = false;
      return;
    }
    if (
      entry.status === "queued" ||
      entry.status === "analyzing" ||
      entry.status === "finalizing"
    ) {
      retryProgressObservedRef.current = true;
      return;
    }
    if (entry.status === "ready" || retryProgressObservedRef.current) {
      retryProgressObservedRef.current = false;
      setRetrySucceeded(false);
      setRetryStatus(null);
    }
  }, [entry.status, retrySucceeded]);

  useEffect(() => {
    if (!hasOpenedManagement.current) return;

    const focusTimer = window.setTimeout(() => {
      if (isManaging) managementHeadingRef.current?.focus();
      else manageButtonRef.current?.focus();
    });

    return () => window.clearTimeout(focusTimer);
  }, [isManaging]);

  const resetDraft = () => {
    setTitle(entry.title ?? "");
    setTldr(entry.tldr ?? "");
    setSourceType(entry.sourceType);
    setSourceDate(entry.sourcePublishedAt ?? "");
    setSourceDateKind(entry.sourceDateKind ?? "published");
    setSelectedTagIds(entry.tags.map((tag) => tag.id));
    setManagementError(null);
    setConfirmDelete(false);
  };

  const handleResetDraft = () => {
    if (activeOperationRef.current) return;
    resetDraft();
  };

  const handleDeletePrompt = (confirmed: boolean) => {
    if (activeOperationRef.current) return;
    setManagementError(null);
    setConfirmDelete(confirmed);
  };

  const toggleTag = (tagId: string) => {
    if (activeOperationRef.current) return;
    setSelectedTagIds((currentIds) => {
      if (currentIds.includes(tagId)) {
        return currentIds.filter((currentId) => currentId !== tagId);
      }
      if (currentIds.length >= MAX_ENTRY_TAGS) return currentIds;
      return [...currentIds, tagId];
    });
  };

  const closeManagement = () => {
    if (activeOperationRef.current) return;
    resetDraft();
    setSelectedFile(null);
    setPreviewUrl(null);
    setUploadError(null);
    setUploadStatus(null);
    setIsManaging(false);
  };

  const toggleManagement = () => {
    if (activeOperationRef.current) return;
    if (isManaging) {
      closeManagement();
      return;
    }

    hasOpenedManagement.current = true;
    setManagementError(null);
    setConfirmDelete(false);
    setIsManaging(true);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (activeOperationRef.current) return;
    const file = event.target.files?.[0] ?? null;
    setUploadError(null);
    setUploadStatus(null);

    if (!file) {
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!ACCEPTED_THUMBNAIL_TYPES.has(file.type)) {
      setSelectedFile(null);
      setPreviewUrl(null);
      setUploadError("Choose a JPEG, PNG, or WebP image.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_THUMBNAIL_BYTES) {
      setSelectedFile(null);
      setPreviewUrl(null);
      setUploadError("The image must be 5 MiB or smaller.");
      event.target.value = "";
      return;
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleUpload = async () => {
    if (!selectedFile || !canEditEntry || !beginOperation("upload")) return;
    setUploadError(null);
    setUploadStatus(null);

    try {
      const endpoint = `/api/v1/entries/${encodeURIComponent(entry.id)}/thumbnail`;
      const prepareResponse = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "prepare",
            contentType: selectedFile.type,
            fileSize: selectedFile.size,
          }),
        },
        {
          timeoutMs: THUMBNAIL_PREPARATION_TIMEOUT_MS,
          timeoutMessage:
            "Preparing the upload took too long. Check your connection and try again.",
        },
      );
      const preparation = await readApiEnvelope<ThumbnailUploadPreparation>(prepareResponse);
      if (!prepareResponse.ok || preparation.error || !preparation.data) {
        throw new Error(
          getRequestErrorMessage(
            prepareResponse,
            preparation.error,
            "The thumbnail upload could not be prepared.",
          ),
        );
      }

      const upload = preparation.data.upload;
      const { error: uploadError } = await withTimeout(
        createBrowserSupabaseClient({
          fetch: (input, init) =>
            fetchWithTimeout(input, init, {
              timeoutMs: THUMBNAIL_UPLOAD_TIMEOUT_MS,
              timeoutMessage: "Uploading took too long. Check your connection and try again.",
            }),
        })
          .storage.from(upload.bucket)
          .uploadToSignedUrl(upload.path, upload.token, selectedFile, {
            cacheControl: "0",
            contentType: selectedFile.type,
          }),
        {
          timeoutMs: THUMBNAIL_UPLOAD_TIMEOUT_MS,
          timeoutMessage: "Uploading took too long. Check your connection and try again.",
        },
      );
      if (uploadError) {
        const underlyingError = (uploadError as { originalError?: unknown }).originalError;
        if (underlyingError instanceof RequestTimeoutError) throw underlyingError;
        throw new Error("The image could not be transferred to private storage.");
      }

      const finalizeResponse = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "finalize", uploadPath: upload.path }),
        },
        {
          timeoutMs: THUMBNAIL_PREPARATION_TIMEOUT_MS,
          timeoutMessage:
            "Validating the thumbnail took too long. Check your connection and try again.",
        },
      );
      const finalized = await readApiEnvelope<ThumbnailResponse>(finalizeResponse);
      if (!finalizeResponse.ok || finalized.error || !finalized.data) {
        throw new Error(
          getRequestErrorMessage(
            finalizeResponse,
            finalized.error,
            "The thumbnail could not be validated and attached.",
          ),
        );
      }

      setSelectedFile(null);
      setCurrentThumbnailUrl(finalized.data.thumbnailUrl);
      setCurrentThumbnailOrigin("manual");
      setFailedThumbnailUrl(null);
      setPreviewUrl(null);
      setUploadStatus("Thumbnail updated.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch (error: unknown) {
      setUploadError(
        error instanceof Error ? error.message : "The thumbnail could not be uploaded.",
      );
    } finally {
      finishOperation("upload");
    }
  };

  const handleSave = async () => {
    if (!canEditEntry || !beginOperation("save")) return;
    setManagementError(null);
    try {
      if (sourceDate && !isValidSourceDate(sourceDate))
        throw new Error("Choose a valid source date that is not in the future.");
      const response = await fetchWithTimeout(
        `/api/v1/entries/${encodeURIComponent(entry.id)}`,
        {
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: title.trim(),
            tldr: tldr.trim(),
            sourceType,
            tagIds: selectedTagIds,
            ...(sourceDate !== (entry.sourcePublishedAt ?? "") ||
            (sourceDate && sourceDateKind !== entry.sourceDateKind)
              ? {
                  sourcePublishedAt: sourceDate || null,
                  sourceDateKind: sourceDate ? sourceDateKind : null,
                }
              : {}),
          }),
        },
        { timeoutMessage: "Saving took too long. Check your connection and try again." },
      );
      const envelope = await readApiEnvelope<UpdateEntryResponse>(response);
      if (!response.ok || envelope.error || !envelope.data) {
        throw new Error(
          getRequestErrorMessage(response, envelope.error, "The entry could not be updated."),
        );
      }
      router.refresh();
      finishOperation("save");
      onClose();
    } catch (error: unknown) {
      setManagementError(
        error instanceof Error ? error.message : "The entry could not be updated.",
      );
    } finally {
      finishOperation("save");
    }
  };

  const handleRetry = async () => {
    if (!canRetry || retrySucceeded || !beginOperation("retry")) return;
    setManagementError(null);
    setRetryStatus(null);

    try {
      const response = await fetchWithTimeout(
        `/api/v1/entries/${encodeURIComponent(entry.id)}/retry`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
        },
        { timeoutMessage: "Retrying took too long. Check your connection and try again." },
      );
      const envelope = await readApiEnvelope<RetryResponse>(response);
      if (!response.ok || envelope.error || !envelope.data) {
        throw new Error(
          getRequestErrorMessage(response, envelope.error, "This entry could not be retried."),
        );
      }
      setRetryStatus("Entry queued for processing.");
      setRetrySucceeded(true);
      router.refresh();
    } catch (error: unknown) {
      setManagementError(
        error instanceof Error ? error.message : "This entry could not be retried.",
      );
    } finally {
      finishOperation("retry");
    }
  };

  const handleDelete = async () => {
    if (!canEditEntry || !confirmDelete || !beginOperation("delete")) return;
    setManagementError(null);
    try {
      const response = await fetchWithTimeout(
        `/api/v1/entries/${encodeURIComponent(entry.id)}`,
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
        },
        { timeoutMessage: "Deleting took too long. Check your connection and try again." },
      );
      const envelope = await readApiEnvelope<{ id: string; deleted: true }>(response);
      if (!response.ok || envelope.error || !envelope.data) {
        throw new Error(
          getRequestErrorMessage(response, envelope.error, "The entry could not be deleted."),
        );
      }
      finishOperation("delete");
      onClose();
      router.refresh();
    } catch (error: unknown) {
      setManagementError(
        error instanceof Error ? error.message : "The entry could not be deleted.",
      );
    } finally {
      finishOperation("delete");
    }
  };

  return (
    <Dialog
      isOpen
      onClose={handleRequestClose}
      closeDisabled={isBusy}
      title={entryTitle}
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={handleRequestClose}
            disabled={isBusy}
            className="w-full rounded-xl bg-[#E9EDF7] px-4 py-2.5 text-sm font-bold text-[#1B254B] transition-colors hover:bg-[#DDE3F0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-50 sm:w-auto"
          >
            Close
          </button>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            {canManage ? (
              <button
                ref={manageButtonRef}
                type="button"
                onClick={toggleManagement}
                disabled={isBusy}
                aria-expanded={isManaging}
                aria-controls={isManaging ? managementPanelId : undefined}
                className="inline-flex items-center gap-2 rounded-xl bg-[#1B254B] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#293665] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B254B] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
              >
                {isManaging ? (
                  <ArrowLeft aria-hidden="true" size={16} />
                ) : (
                  <SlidersHorizontal aria-hidden="true" size={16} />
                )}
                {isManaging ? "Back to details" : "Manage entry"}
              </button>
            ) : null}
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open original: ${entryTitle}`}
              title="Open original"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-blue-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ExternalLink aria-hidden="true" size={18} />
            </a>
          </div>
        </div>
      }
    >
      {isManaging ? (
        <div
          id={managementPanelId}
          role="region"
          aria-labelledby={managementHeadingId}
          aria-busy={isBusy}
          className="space-y-5"
        >
          <header>
            <p className="text-xs font-extrabold uppercase tracking-[0.15em] text-primary">
              Entry settings
            </p>
            <h3
              id={managementHeadingId}
              ref={managementHeadingRef}
              tabIndex={-1}
              className="mt-2 text-xl font-extrabold text-[#1B254B] outline-none"
            >
              Manage entry
            </h3>
            <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
              Edit the content, replace its image, or manage this entry safely.
            </p>
          </header>

          {isProcessingDelayed ? (
            <p
              role="status"
              className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900 ring-1 ring-inset ring-amber-200"
            >
              <AlertTriangle aria-hidden="true" size={16} />
              Taking longer than usual
            </p>
          ) : null}

          {processingError ? (
            <p
              role="alert"
              className="rounded-xl bg-red-50 p-3 text-sm font-bold leading-relaxed text-red-800 ring-1 ring-inset ring-red-200"
            >
              {processingError}
            </p>
          ) : null}

          <p role="status" className="sr-only">
            {activeOperation ? operationAnnouncements[activeOperation] : ""}
          </p>

          {managementError ? (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
              {managementError}
            </p>
          ) : null}

          {canEditEntry ? (
            <section
              aria-labelledby="entry-edit-heading"
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5"
            >
              <h4 id="entry-edit-heading" className="font-extrabold text-[#1B254B]">
                Edit content
              </h4>
              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="entry-edit-title" className="text-sm font-bold text-[#1B254B]">
                    Title
                  </label>
                  <input
                    id="entry-edit-title"
                    value={title}
                    onChange={(event) => {
                      if (!activeOperationRef.current) setTitle(event.target.value);
                    }}
                    disabled={isBusy}
                    minLength={3}
                    maxLength={100}
                    className="mt-2 w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
                <div>
                  <label htmlFor="entry-edit-summary" className="text-sm font-bold text-[#1B254B]">
                    Summary
                  </label>
                  <textarea
                    id="entry-edit-summary"
                    value={tldr}
                    onChange={(event) => {
                      if (!activeOperationRef.current) setTldr(event.target.value);
                    }}
                    disabled={isBusy}
                    minLength={30}
                    maxLength={800}
                    rows={5}
                    className="mt-2 w-full resize-y rounded-xl border border-border bg-white px-3 py-2 text-sm text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#1B254B]">Source type</p>
                  <CustomSelect
                    ariaLabel="Source type"
                    options={SOURCE_TYPE_OPTIONS}
                    value={sourceType}
                    onChange={(value) => {
                      if (!activeOperationRef.current) setSourceType(value as SourceType);
                    }}
                    disabled={isBusy}
                    className="mt-2 w-full"
                    dropdownClassName="w-[min(24rem,calc(100vw-1.5rem))]"
                  />
                </div>
                <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                  <label htmlFor="entry-source-date" className="text-sm font-bold text-[#1B254B]">
                    Source date
                  </label>
                  <p id="source-date-help" className="mt-1 text-xs leading-relaxed text-slate-500">
                    Publication or release date from the original source. Leave blank if unknown.
                    Your correction is kept when processing is retried.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <input
                      id="entry-source-date"
                      type="date"
                      value={sourceDate}
                      min="1900-01-01"
                      max={new Date().toISOString().slice(0, 10)}
                      aria-describedby="source-date-help"
                      disabled={isBusy}
                      onChange={(event) => {
                        if (!activeOperationRef.current) setSourceDate(event.target.value);
                      }}
                      className="min-w-0 rounded-xl border border-border bg-white px-3 py-2 text-sm text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    />
                    <CustomSelect
                      ariaLabel="Source date type"
                      value={sourceDateKind}
                      options={Object.entries(SOURCE_DATE_LABELS).map(([value, label]) => ({
                        value,
                        label,
                      }))}
                      onChange={(value) => {
                        if (!activeOperationRef.current) setSourceDateKind(value as SourceDateKind);
                      }}
                      disabled={isBusy || !sourceDate}
                    />
                    {sourceDate ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setSourceDate("")}
                        className="text-xs font-bold text-slate-500 hover:text-primary"
                      >
                        Clear date
                      </button>
                    ) : null}
                  </div>
                </div>
                <fieldset>
                  <legend className="text-sm font-bold text-[#1B254B]">Tags</legend>
                  <p id="entry-edit-tags-help" className="mt-1 text-xs font-medium text-slate-500">
                    Choose up to {MAX_ENTRY_TAGS} existing tags. New tags are managed by an
                    administrator.
                  </p>
                  {allTags.length ? (
                    <div
                      className="mt-3 flex max-h-48 flex-wrap content-start gap-2 overflow-y-auto rounded-2xl bg-white p-3"
                      aria-describedby="entry-edit-tags-help entry-edit-tags-count"
                    >
                      {allTags.map((tag) => {
                        const isSelected = selectedTagIds.includes(tag.id);
                        const unavailable =
                          isBusy || (!isSelected && selectedTagIds.length >= MAX_ENTRY_TAGS);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            aria-pressed={isSelected}
                            aria-label={`${tag.name}, ${isSelected ? "selected" : "not selected"}`}
                            onClick={() => toggleTag(tag.id)}
                            disabled={unavailable}
                            className={`${catalogCardStyles.tag} inline-flex items-center gap-1.5 transition-[opacity,transform,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed ${
                              isSelected
                                ? "shadow-[0_4px_12px_rgba(15,23,42,0.12)]"
                                : "opacity-55 hover:scale-[1.02] hover:opacity-90"
                            }`}
                            style={getTintedTagStyle(tag.color)}
                          >
                            {isSelected ? (
                              <Check aria-hidden="true" size={13} strokeWidth={3} />
                            ) : null}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm font-medium text-slate-500">
                      No tags are available.
                    </p>
                  )}
                  <p
                    id="entry-edit-tags-count"
                    aria-live="polite"
                    className="mt-2 text-right text-xs font-medium text-slate-500"
                  >
                    {selectedTagIds.length} of {MAX_ENTRY_TAGS} selected
                  </p>
                </fieldset>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={
                      isBusy ||
                      title.trim().length < 3 ||
                      tldr.trim().length < 30 ||
                      selectedTagIds.length > MAX_ENTRY_TAGS
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
                  >
                    {activeOperation === "save" ? (
                      <Loader2 aria-hidden="true" className="animate-spin" size={15} />
                    ) : (
                      <Save aria-hidden="true" size={15} />
                    )}
                    {activeOperation === "save" ? "Saving…" : "Save changes"}
                  </button>
                  <button
                    type="button"
                    onClick={handleResetDraft}
                    disabled={isBusy}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <RotateCcw aria-hidden="true" size={15} />
                    Reset changes
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <p className="rounded-xl bg-blue-50 p-3 text-sm font-medium text-blue-800">
              Content editing becomes available when processing finishes.
            </p>
          )}

          {canRetry ? (
            <section
              aria-labelledby="entry-retry-heading"
              className="rounded-2xl border border-blue-200 bg-blue-50 p-4 sm:p-5"
            >
              <h4 id="entry-retry-heading" className="font-extrabold text-blue-950">
                Processing
              </h4>
              <p className="mt-1 text-sm font-medium text-blue-800">
                Run the analysis again without creating a duplicate entry.
              </p>
              <button
                type="button"
                onClick={handleRetry}
                disabled={isBusy || retrySucceeded}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-blue-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:opacity-60"
              >
                {activeOperation === "retry" ? (
                  <Loader2 aria-hidden="true" className="animate-spin" size={15} />
                ) : (
                  <RefreshCw aria-hidden="true" size={15} />
                )}
                {activeOperation === "retry" ? "Retrying…" : retrySucceeded ? "Queued" : "Retry"}
              </button>
              {retryStatus ? (
                <p role="status" className="mt-3 text-sm font-bold text-emerald-700">
                  {retryStatus}
                </p>
              ) : null}
            </section>
          ) : null}

          {canEditEntry ? (
            <section
              aria-labelledby="thumbnail-upload-heading"
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5"
            >
              <h4 id="thumbnail-upload-heading" className="font-extrabold text-[#1B254B]">
                Replace thumbnail
              </h4>
              <p id="thumbnail-help" className="mt-1 text-xs font-medium text-slate-500">
                JPEG, PNG, or WebP, up to 5 MiB.
              </p>
              <div className="mt-4 overflow-hidden rounded-2xl bg-white">
                {/* Runtime thumbnail hosts are deployment-restricted; fallbacks are bundled locally. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={displayedThumbnailUrl}
                  alt=""
                  className="aspect-[21/9] h-auto w-full object-cover"
                  onError={() => {
                    if (previewUrl) {
                      setSelectedFile(null);
                      setPreviewUrl(null);
                      setUploadError("This image could not be previewed.");
                    } else if (currentThumbnailUrl) {
                      setFailedThumbnailUrl(currentThumbnailUrl);
                    }
                  }}
                />
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-describedby="thumbnail-help"
                  onChange={handleFileChange}
                  disabled={isBusy}
                  className="min-w-0 flex-1 text-sm text-[#47548C] file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-bold file:text-primary hover:file:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={!selectedFile || isBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1B254B] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#293665] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B254B] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {activeOperation === "upload" ? (
                    <Loader2 aria-hidden="true" className="animate-spin" size={16} />
                  ) : (
                    <ImageUp aria-hidden="true" size={16} />
                  )}
                  {activeOperation === "upload" ? "Uploading…" : "Upload"}
                </button>
              </div>
              {uploadError ? (
                <p role="alert" className="mt-3 text-sm font-bold text-red-700">
                  {uploadError}
                </p>
              ) : null}
              {uploadStatus ? (
                <p role="status" className="mt-3 text-sm font-bold text-emerald-700">
                  {uploadStatus}
                </p>
              ) : null}
            </section>
          ) : null}

          {canEditEntry ? (
            <section
              aria-labelledby="entry-delete-heading"
              className="rounded-2xl border border-red-200 bg-red-50 p-4 sm:p-5"
            >
              <h4 id="entry-delete-heading" className="font-extrabold text-red-900">
                Delete entry
              </h4>
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => handleDeletePrompt(true)}
                  disabled={isBusy}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                >
                  <Trash2 aria-hidden="true" size={15} />
                  Delete entry
                </button>
              ) : (
                <div className="mt-3 rounded-xl border border-red-200 bg-white p-3">
                  <p className="text-sm font-bold text-red-800">
                    Permanently delete this entry and its thumbnail?
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={isBusy}
                      className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:opacity-50"
                    >
                      {activeOperation === "delete" ? (
                        <Loader2 aria-hidden="true" className="animate-spin" size={15} />
                      ) : (
                        <Trash2 aria-hidden="true" size={15} />
                      )}
                      {activeOperation === "delete" ? "Deleting…" : "Confirm deletion"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePrompt(false)}
                      disabled={isBusy}
                      className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      Keep entry
                    </button>
                  </div>
                </div>
              )}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="space-y-6">
          <div className={`${catalogCardStyles.media} rounded-3xl`}>
            {/* Runtime thumbnail hosts are deployment-restricted; fallbacks are bundled locally. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={storedThumbnailUrl}
              alt=""
              className="h-full w-full object-cover"
              onError={() => {
                if (currentThumbnailUrl) setFailedThumbnailUrl(currentThumbnailUrl);
              }}
            />
            <span className={catalogCardStyles.sourceBadge}>
              {entry.sourceType === "opensource" ? "Open source" : "Proprietary"}
            </span>
            {isUsingPlaceholder ? (
              <span className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg bg-white/65 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-700 shadow-sm ring-1 ring-white/70 backdrop-blur-md">
                No preview
              </span>
            ) : null}
            {visibleStatus ? (
              <span
                aria-label={`Status: ${statusLabels[visibleStatus]}`}
                className={`absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.13em] backdrop-blur ${
                  visibleStatus === "failed" ? "bg-red-950/75 text-white" : "bg-white text-primary"
                }`}
              >
                {isProcessing ? (
                  <Loader2 aria-hidden="true" className="animate-spin" size={12} />
                ) : null}
                {visibleStatus === "failed" ? <AlertTriangle aria-hidden="true" size={12} /> : null}
                {statusLabels[visibleStatus]}
              </span>
            ) : null}
          </div>

          {isProcessingDelayed ? (
            <p
              role="status"
              className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900 ring-1 ring-inset ring-amber-200"
            >
              <AlertTriangle aria-hidden="true" size={16} />
              Taking longer than usual
            </p>
          ) : null}

          {processingError ? (
            <p
              role="alert"
              className="rounded-xl bg-red-50 p-3 text-sm font-bold leading-relaxed text-red-800 ring-1 ring-inset ring-red-200"
            >
              {processingError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-4">
            <time
              title="Added to Curio"
              className={catalogCardStyles.date}
              dateTime={entry.createdAt}
            >
              Added {formatDate(entry.createdAt)}
            </time>
            {entry.authorEmail ? (
              <span className="inline-flex items-center gap-2 border-l border-slate-200 pl-4 text-sm font-bold text-slate-500">
                <AuthorAvatar
                  email={entry.authorEmail}
                  displayName={entry.authorDisplayName}
                  src={entry.authorAvatarUrl}
                  size={26}
                />
                <span>
                  {getAuthorDetails(entry.authorEmail, entry.authorDisplayName).displayName}
                  <span className="sr-only"> ({entry.authorEmail})</span>
                </span>
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <SourceAgeBadge date={entry.sourcePublishedAt} kind={entry.sourceDateKind} />
            {entry.sourcePublishedAt ? (
              <span>
                {entry.sourceDateKind ? SOURCE_DATE_LABELS[entry.sourceDateKind] : "Source"}:{" "}
                <time dateTime={entry.sourcePublishedAt}>
                  {formatDate(entry.sourcePublishedAt)}
                </time>
                {entry.sourceDateOrigin === "manual"
                  ? " · Manually set"
                  : " · Extracted from source"}
              </span>
            ) : (
              <span>No reliable date found in the source.</span>
            )}
          </div>
          <section aria-labelledby="entry-summary-heading">
            <h3
              id="entry-summary-heading"
              className="text-xs font-extrabold uppercase tracking-[0.15em] text-primary"
            >
              Summary
            </h3>
            <p className="mt-3 whitespace-pre-wrap text-base font-medium leading-relaxed text-slate-600">
              {entry.tldr ?? "No summary is available yet."}
            </p>
          </section>

          <section aria-labelledby="entry-tags-heading">
            <h3
              id="entry-tags-heading"
              className="text-xs font-extrabold uppercase tracking-[0.15em] text-primary"
            >
              Tags
            </h3>
            {entry.tags.length ? (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Tags">
                {entry.tags.map((tag) => (
                  <li
                    key={tag.id}
                    className={catalogCardStyles.tag}
                    style={getTintedTagStyle(tag.color)}
                  >
                    {tag.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm font-medium text-slate-500">No tags assigned.</p>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
