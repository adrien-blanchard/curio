import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiErrorResponse, apiFailure, apiSuccess } from "@/lib/api/response";
import { AuthenticationError } from "@/lib/auth/errors";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API response envelopes", () => {
  it("serializes success with null error and preserves response metadata", async () => {
    const response = apiSuccess(
      { id: "synthetic-entry" },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: { id: "synthetic-entry" },
      error: null,
    });
  });

  it("serializes a failure without a data value", async () => {
    const response = apiFailure(409, "ENTRY_CONFLICT", "The entry already exists", {
      field: "url",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      data: null,
      error: {
        code: "ENTRY_CONFLICT",
        message: "The entry already exists",
        details: { field: "url" },
      },
    });
  });

  it("maps authentication and application errors to their stable public form", async () => {
    const authenticationResponse = apiErrorResponse(
      new AuthenticationError("INSUFFICIENT_SCOPE", "Scope required", 403),
    );
    expect(authenticationResponse.status).toBe(403);
    expect(await authenticationResponse.json()).toEqual({
      data: null,
      error: { code: "INSUFFICIENT_SCOPE", message: "Scope required" },
    });

    const applicationResponse = apiErrorResponse(
      new ApiError(422, "INVALID_INPUT", "Input rejected", { field: "name" }),
    );
    expect(applicationResponse.status).toBe(422);
    expect(await applicationResponse.json()).toEqual({
      data: null,
      error: {
        code: "INVALID_INPUT",
        message: "Input rejected",
        details: { field: "name" },
      },
    });
  });

  it("maps Zod failures without echoing rejected values", async () => {
    const schema = z.strictObject({ name: z.string().min(3) });
    let validationError: unknown;
    try {
      schema.parse({ name: "x", secret: "do-not-echo" });
    } catch (error) {
      validationError = error;
    }

    const response = apiErrorResponse(validationError);
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      data: null,
      error: { code: "VALIDATION_ERROR", message: "Invalid request payload" },
    });
    expect(JSON.stringify(payload)).not.toContain("do-not-echo");
  });

  it("logs an unexpected server error but returns no internal message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = apiErrorResponse(new Error("database password appeared here"));
    const payload = await response.json();

    expect(consoleError).toHaveBeenCalledOnce();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("database password");
    expect(response.status).toBe(500);
    expect(payload).toEqual({
      data: null,
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
    });
    expect(JSON.stringify(payload)).not.toContain("database password");
  });
});
