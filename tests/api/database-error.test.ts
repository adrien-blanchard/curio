import { describe, expect, it } from "vitest";

import { mapDatabaseError } from "@/lib/api/database-error";

describe("database error mapping", () => {
  it.each([
    ["rate_limit_exceeded", "P0001", 429, "RATE_LIMIT_EXCEEDED"],
    ["entry_not_found", "P0001", 404, "ENTRY_NOT_FOUND"],
    ["token_not_found", "P0001", 404, "TOKEN_NOT_FOUND"],
    ["token_limit_reached", "54000", 409, "TOKEN_LIMIT_REACHED"],
    ["invalid_token_configuration", "22023", 400, "INVALID_TOKEN_CONFIGURATION"],
    ["opaque", "PGRST116", 404, "ENTRY_NOT_FOUND"],
    ["entry_forbidden", "P0001", 403, "ENTRY_FORBIDDEN"],
    ["opaque", "42501", 403, "ENTRY_FORBIDDEN"],
    ["invalid_entry_state", "P0001", 409, "ENTRY_CONFLICT"],
    ["opaque", "23505", 409, "ENTRY_CONFLICT"],
    ["invalid_tag", "P0001", 400, "INVALID_TAGS"],
    ["invalid_source_date", "22023", 400, "INVALID_SOURCE_DATE"],
    ["opaque", "23503", 400, "INVALID_TAGS"],
  ])("maps %s / %s to HTTP %i %s", (message, code, status, publicCode) => {
    expect(mapDatabaseError({ message, code }, "FALLBACK", "Safe fallback")).toMatchObject({
      status,
      code: publicCode,
    });
  });

  it("uses the caller's safe fallback without exposing an unknown database message", () => {
    const error = mapDatabaseError(
      { code: "XX999", message: "internal relation and SQL details" },
      "OPERATION_FAILED",
      "The operation could not be completed",
    );
    expect(error).toMatchObject({
      status: 500,
      code: "OPERATION_FAILED",
      message: "The operation could not be completed",
    });
    expect(error.message).not.toContain("relation");
  });
});
