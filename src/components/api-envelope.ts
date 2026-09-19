import type { ApiEnvelope, ApiError } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseError(value: unknown): ApiError | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return { message: value };
  if (!isRecord(value)) return { message: "The server returned an invalid error." };

  return {
    code: typeof value.code === "string" ? value.code : undefined,
    message:
      typeof value.message === "string" ? value.message : "The request could not be completed.",
    details: value.details,
  };
}

export async function readApiEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return {
      data: null,
      error: { message: "The server returned an unreadable response." },
    };
  }

  if (!isRecord(payload)) {
    return {
      data: null,
      error: { message: "The server returned an invalid response." },
    };
  }

  return {
    data: (payload.data ?? null) as T | null,
    error: parseError(payload.error),
  };
}

export function getRequestErrorMessage(
  response: Response,
  error: ApiError | null,
  fallback: string,
): string {
  if (error?.message) return error.message;
  if (response.status === 401) return "Your session has expired. Sign in again.";
  if (response.status === 403) return "You do not have permission for this action.";
  if (response.status === 429) return "Too many requests. Please try again shortly.";
  return fallback;
}
