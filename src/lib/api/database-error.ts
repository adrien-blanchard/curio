import type { PostgrestError } from "@supabase/supabase-js";

import { ApiError } from "./response";

type DatabaseErrorLike = Pick<PostgrestError, "code" | "message">;

/** Maps intentionally stable database errors without exposing SQL details. */
export function mapDatabaseError(
  error: DatabaseErrorLike,
  fallbackCode: string,
  fallbackMessage: string,
): ApiError {
  const marker = `${error.code} ${error.message}`.toLowerCase();

  if (marker.includes("rate_limit")) {
    return new ApiError(
      429,
      "RATE_LIMIT_EXCEEDED",
      "No more than five entries may be submitted per minute",
    );
  }
  if (marker.includes("entry_not_found") || error.code === "PGRST116") {
    return new ApiError(404, "ENTRY_NOT_FOUND", "The entry was not found");
  }
  if (marker.includes("profile_not_found")) {
    return new ApiError(404, "PROFILE_NOT_FOUND", "The profile was not found");
  }
  if (marker.includes("token_not_found")) {
    return new ApiError(404, "TOKEN_NOT_FOUND", "API token not found");
  }
  if (marker.includes("token_limit")) {
    return new ApiError(409, "TOKEN_LIMIT_REACHED", "Revoke an active token before creating one");
  }
  if (
    marker.includes("invalid_token_configuration") ||
    marker.includes("invalid_token_expiration")
  ) {
    return new ApiError(400, "INVALID_TOKEN_CONFIGURATION", "The token configuration is invalid");
  }
  if (marker.includes("last_admin")) {
    return new ApiError(
      409,
      "LAST_ADMIN_REQUIRED",
      "The last administrator cannot be removed or demoted",
    );
  }
  if (
    marker.includes("entry_forbidden") ||
    marker.includes("insufficient_privilege") ||
    error.code === "42501"
  ) {
    return new ApiError(403, "ENTRY_FORBIDDEN", "You cannot modify this entry");
  }
  if (
    marker.includes("invalid_entry_state") ||
    marker.includes("entry_not_retryable") ||
    marker.includes("entry_already_exists") ||
    error.code === "23505"
  ) {
    return new ApiError(
      409,
      "ENTRY_CONFLICT",
      "The entry already exists or is not in a compatible state",
    );
  }
  if (marker.includes("invalid_tag") || error.code === "23503") {
    return new ApiError(400, "INVALID_TAGS", "One or more selected tags do not exist");
  }
  if (marker.includes("invalid_source_date")) {
    return new ApiError(400, "INVALID_SOURCE_DATE", "Choose a valid source date and date type");
  }
  return new ApiError(500, fallbackCode, fallbackMessage);
}
