import { useEffect, useState } from "react";

import type { CurioEntry } from "./types";

export const PROCESSING_DELAY_WARNING_MS = 2 * 60 * 1_000;

const PROCESSING_STATUSES = new Set<CurioEntry["status"]>(["queued", "analyzing", "finalizing"]);

const PUBLIC_ERROR_CODES = new Set([
  "PROCESSING_TIMEOUT",
  "WORKFLOW_START_FAILED",
  "GEMINI_AUTHENTICATION_FAILED",
  "GEMINI_QUOTA_EXCEEDED",
  "GEMINI_REQUEST_TIMEOUT",
  "GEMINI_TEMPORARILY_UNAVAILABLE",
  "SOURCE_RETRIEVAL_FAILED",
  "SOURCE_REDIRECT_NOT_ALLOWED",
  "AI_OUTPUT_INVALID",
  "DATABASE_ERROR",
  "THUMBNAIL_STORAGE_FAILED",
  "THUMBNAIL_CLEANUP_FAILED",
]);

const FALLBACK_ERROR_MESSAGES: Record<string, string> = {
  PROCESSING_TIMEOUT:
    "Processing stopped because it took too long. Check the source and retry when you are ready.",
  WORKFLOW_START_FAILED: "Processing could not start. Please retry this entry.",
  GEMINI_AUTHENTICATION_FAILED:
    "The AI service is not configured correctly. Contact an administrator.",
  GEMINI_QUOTA_EXCEEDED: "The AI service has reached its quota. Please try again later.",
  GEMINI_REQUEST_TIMEOUT: "The AI service took too long to respond. Please retry this entry later.",
  GEMINI_TEMPORARILY_UNAVAILABLE:
    "The AI service is temporarily unavailable. Please try again later.",
  SOURCE_RETRIEVAL_FAILED: "Curio could not read this public source. Check the link and retry.",
  SOURCE_REDIRECT_NOT_ALLOWED:
    "The source redirected to a different address and could not be analyzed safely.",
  AI_OUTPUT_INVALID: "The AI response could not be validated. Please retry this entry.",
  DATABASE_ERROR: "Curio could not save the processing result. Please retry this entry.",
  THUMBNAIL_STORAGE_FAILED: "Curio could not save the preview image. Please retry this entry.",
  THUMBNAIL_CLEANUP_FAILED: "The entry was processed, but an old preview could not be cleaned up.",
};

function processingReferenceTimestamp(entry: CurioEntry): number | null {
  const timestamp = Date.parse(entry.processingHeartbeatAt ?? entry.createdAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isEntryProcessing(entry: CurioEntry): boolean {
  return PROCESSING_STATUSES.has(entry.status);
}

export function isProcessingDelayed(entry: CurioEntry, now = Date.now()): boolean {
  if (!isEntryProcessing(entry)) return false;
  const reference = processingReferenceTimestamp(entry);
  return reference !== null && now - reference >= PROCESSING_DELAY_WARNING_MS;
}

export function useProcessingDelay(entry: CurioEntry): boolean {
  const stateKey = `${entry.id}:${entry.status}:${entry.processingHeartbeatAt ?? entry.createdAt}`;
  const [delayState, setDelayState] = useState(() => ({
    key: stateKey,
    isDelayed: isProcessingDelayed(entry),
  }));
  const isDelayed = delayState.key === stateKey ? delayState.isDelayed : isProcessingDelayed(entry);

  useEffect(() => {
    if (!isEntryProcessing(entry)) return;

    const reference = processingReferenceTimestamp(entry);
    if (reference === null) return;

    const remaining = PROCESSING_DELAY_WARNING_MS - (Date.now() - reference);
    if (remaining <= 0) return;

    const timer = window.setTimeout(
      () => setDelayState({ key: stateKey, isDelayed: true }),
      remaining,
    );
    return () => window.clearTimeout(timer);
  }, [entry, stateKey]);

  return isDelayed;
}

function isSafePublicMessage(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || normalized.length > 240 || /[\u0000-\u001F\u007F]/u.test(normalized)) {
    return false;
  }
  return !/(?:api[_ -]?key|authorization|bearer|secret|access[_ -]?token|stack trace)/iu.test(
    normalized,
  );
}

/**
 * Only explicitly public workflow errors may use the stored message. Unknown
 * failures receive a stable generic message so internal provider details or
 * credentials can never leak into a card.
 */
export function getSafeProcessingErrorMessage(entry: CurioEntry): string | null {
  if (entry.status !== "failed") return null;
  const code = entry.errorCode?.trim().toUpperCase() ?? "";
  if (code === "GEMINI_REQUEST_TIMEOUT") return FALLBACK_ERROR_MESSAGES[code];
  if (
    code &&
    PUBLIC_ERROR_CODES.has(code) &&
    entry.errorMessage &&
    isSafePublicMessage(entry.errorMessage)
  ) {
    return entry.errorMessage.trim();
  }
  return (
    FALLBACK_ERROR_MESSAGES[code] ??
    "Processing could not be completed. Check the source and try again."
  );
}
