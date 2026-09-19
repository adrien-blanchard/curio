"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Code, Loader2, Lock, Plus } from "lucide-react";
import Dialog from "./Dialog";
import { getRequestErrorMessage, readApiEnvelope } from "./api-envelope";
import type { CurioTag, EntryStatus, SourceType } from "./types";
import { fetchWithTimeout } from "@/lib/http/fetch-with-timeout";

const MAX_TAGS = 10;

type TagsResponse = {
  tags: CurioTag[];
};

type SubmitEntryResponse = {
  id: string;
  status: EntryStatus;
};

type SubmitLinkModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function SubmitLinkModal({ isOpen, onClose }: SubmitLinkModalProps) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("opensource");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<CurioTag[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();

    async function loadTags() {
      setIsLoadingTags(true);
      setError(null);
      try {
        const response = await fetchWithTimeout(
          "/api/v1/tags",
          {
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
          {
            timeoutMessage: "Loading tags took too long. Check your connection and try again.",
          },
        );
        const envelope = await readApiEnvelope<TagsResponse>(response);
        if (!response.ok || envelope.error || !envelope.data) {
          throw new Error(
            getRequestErrorMessage(response, envelope.error, "Tags could not be loaded."),
          );
        }
        setAvailableTags(envelope.data.tags);
      } catch (loadError: unknown) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Tags could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setIsLoadingTags(false);
      }
    }

    void loadTags();
    return () => controller.abort();
  }, [isOpen]);

  const handleClose = useCallback(() => {
    if (!isSubmitting) onClose();
  }, [isSubmitting, onClose]);

  const toggleTag = (tagId: string) => {
    setError(null);
    if (selectedTagIds.includes(tagId)) {
      setSelectedTagIds((currentIds) => currentIds.filter((id) => id !== tagId));
      return;
    }
    if (selectedTagIds.length >= MAX_TAGS) {
      setError(`Select no more than ${MAX_TAGS} tags.`);
      return;
    }
    setSelectedTagIds((currentIds) => [...currentIds, tagId]);
  };

  const resetForm = () => {
    setUrl("");
    setSourceType("opensource");
    setSelectedTagIds([]);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetchWithTimeout(
        "/api/v1/entries",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: url.trim(),
            sourceType,
            tagIds: selectedTagIds,
          }),
        },
        { timeoutMessage: "Submitting took too long. Check your connection and try again." },
      );
      const envelope = await readApiEnvelope<SubmitEntryResponse>(response);
      if (response.status !== 202 || envelope.error || !envelope.data) {
        throw new Error(
          getRequestErrorMessage(response, envelope.error, "The link could not be submitted."),
        );
      }

      resetForm();
      onClose();
      router.refresh();
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error ? submitError.message : "The link could not be submitted.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="Submit a link"
      description="Curio will analyze the source and add it to the processing queue."
      footer={
        <button
          type="submit"
          form="submit-link-form"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-white shadow-[0_10px_20px_-10px_rgba(36,98,250,0.5)] transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? (
            <Loader2 aria-hidden="true" className="animate-spin" size={18} />
          ) : (
            <Plus aria-hidden="true" size={18} strokeWidth={3} />
          )}
          {isSubmitting ? "Submitting…" : "Submit"}
        </button>
      }
    >
      <form id="submit-link-form" onSubmit={handleSubmit} className="space-y-6">
        {error ? (
          <div
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"
          >
            {error}
          </div>
        ) : null}

        <div>
          <label htmlFor="submission-url" className="mb-2 block text-sm font-bold text-[#1B254B]">
            URL
          </label>
          <input
            id="submission-url"
            data-dialog-initial-focus
            type="url"
            inputMode="url"
            autoComplete="url"
            required
            placeholder="https://example.com/resource"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="w-full rounded-xl border border-transparent bg-[#F4F7FE] px-4 py-3 text-sm font-medium text-[#1B254B] outline-none transition-colors placeholder:text-[#A3AED0] focus:border-primary/40 focus:bg-white focus:ring-2 focus:ring-primary/10"
          />
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-bold text-[#1B254B]">Source type</legend>
          <div className="grid grid-cols-1 gap-2 rounded-2xl border border-[#E2E8F0] bg-[#F4F7FE] p-1.5 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1 ${
                sourceType === "opensource"
                  ? "bg-[#05A67A] text-white shadow-sm"
                  : "text-[#718096] hover:text-[#1B254B]"
              }`}
            >
              <input
                type="radio"
                name="sourceType"
                value="opensource"
                checked={sourceType === "opensource"}
                onChange={() => setSourceType("opensource")}
                className="sr-only"
              />
              <Code aria-hidden="true" size={14} /> Open source
            </label>
            <label
              className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1 ${
                sourceType === "proprietary"
                  ? "bg-[#D9483B] text-white shadow-sm"
                  : "text-[#718096] hover:text-[#1B254B]"
              }`}
            >
              <input
                type="radio"
                name="sourceType"
                value="proprietary"
                checked={sourceType === "proprietary"}
                onChange={() => setSourceType("proprietary")}
                className="sr-only"
              />
              <Lock aria-hidden="true" size={14} /> Proprietary
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-bold text-[#1B254B]">Tags (optional)</legend>
          <p className="mt-1 text-xs font-medium text-[#718096]">
            Choose existing tags. Contributors cannot create new tags.
          </p>
          <div className="mt-3 flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-2xl border border-[#E2E8F0] bg-[#F4F7FE] p-4">
            {isLoadingTags ? (
              <span
                role="status"
                className="flex items-center gap-2 text-xs font-medium text-[#718096]"
              >
                <Loader2 aria-hidden="true" className="animate-spin" size={15} />
                Loading tags…
              </span>
            ) : availableTags.length === 0 ? (
              <span className="text-xs font-medium text-[#718096]">No tags are available.</span>
            ) : (
              availableTags.map((tag) => {
                const isSelected = selectedTagIds.includes(tag.id);
                return (
                  <label
                    key={tag.id}
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors focus-within:ring-2 focus-within:ring-primary ${
                      isSelected
                        ? "border-primary bg-primary text-white"
                        : "border-[#E2E8F0] bg-white text-[#47548C] hover:border-primary/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleTag(tag.id)}
                      className="sr-only"
                    />
                    {isSelected ? "✓ " : "+ "}
                    {tag.name}
                  </label>
                );
              })
            )}
          </div>
          <p className="mt-2 text-right text-xs text-[#718096]" aria-live="polite">
            {selectedTagIds.length} of {MAX_TAGS} selected
          </p>
        </fieldset>
      </form>
    </Dialog>
  );
}
