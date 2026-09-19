export type WorkflowFailureInfo = { code: string; message: string };

const processingTerminalMessages = {
  PROCESSING_ATTEMPT_TERMINAL: "This processing attempt has already finished.",
  PROCESSING_TIMEOUT: "Processing stopped after 15 minutes without progress. Retry to try again.",
} as const;

export type ProcessingTerminalCode = keyof typeof processingTerminalMessages;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "";

  const candidate = error as Record<string, unknown>;
  return [candidate.message, candidate.details, candidate.hint, candidate.code]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

export function hasProcessingFailureCode(
  error: unknown,
  code: ProcessingTerminalCode | "PROCESSING_ATTEMPT_ACTIVE",
): boolean {
  return new RegExp(`(?:^|[^A-Z0-9_])${code}(?:$|[^A-Z0-9_])`, "u").test(errorText(error));
}

/**
 * Recognizes the stable control-flow errors raised by the processing RPCs.
 * Their user-facing messages are defined locally so database diagnostics never
 * cross the API or workflow boundary.
 */
export function processingTerminalFailureInfo(
  error: unknown,
): (WorkflowFailureInfo & { code: ProcessingTerminalCode }) | null {
  const text = errorText(error);
  for (const code of Object.keys(processingTerminalMessages) as ProcessingTerminalCode[]) {
    if (hasProcessingFailureCode(text, code)) {
      return { code, message: processingTerminalMessages[code] };
    }
  }
  return null;
}

/**
 * Extracts the stable `CODE|message` suffix emitted by a step. Workflow DevKit
 * prefixes exhausted-step errors with runtime context, so the marker is not
 * necessarily at the beginning of the final error string.
 */
export function workflowFailureInfo(error: unknown): WorkflowFailureInfo {
  // Workflow steps execute in an isolated VM. Errors crossing that boundary
  // are not guaranteed to satisfy `instanceof Error` in the workflow realm,
  // even though they retain a string `message` property.
  const message = errorText(error) || "The workflow failed unexpectedly.";
  const marker = /(?:^|[^A-Z0-9_])([A-Z][A-Z0-9_]{2,})\|([^\r\n]+)$/u.exec(message);
  return marker
    ? {
        code: marker[1],
        message: marker[2].trim().slice(0, 500),
      }
    : {
        code: "PIPELINE_FAILED",
        // Unknown failures may contain provider diagnostics, URLs, headers, or
        // credentials. Persist only a stable public message; operators should
        // inspect redacted provider logs for the underlying cause.
        message: "Processing failed unexpectedly.",
      };
}
