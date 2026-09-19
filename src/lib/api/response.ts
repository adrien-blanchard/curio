import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError } from "@/lib/auth/errors";
import { EnvironmentValidationError } from "@/lib/env/shared";

export type ApiErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiEnvelope<T> = { data: T; error: null } | { data: null; error: ApiErrorBody };

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function apiSuccess<T>(data: T, init?: ResponseInit): NextResponse<ApiEnvelope<T>> {
  return NextResponse.json({ data, error: null }, init);
}

export function apiFailure(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json(
    {
      data: null,
      error: { code, message, ...(details === undefined ? {} : { details }) },
    },
    { status },
  );
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof AuthenticationError) {
    return apiFailure(error.status, error.code, error.message);
  }
  if (error instanceof ApiError) {
    return apiFailure(error.status, error.code, error.message, error.details);
  }
  if (error instanceof EnvironmentValidationError) {
    return apiFailure(503, "SERVICE_NOT_CONFIGURED", "The backend is not configured");
  }
  if (error instanceof z.ZodError) {
    return apiFailure(400, "VALIDATION_ERROR", "Invalid request payload", {
      fields: error.flatten().fieldErrors,
    });
  }

  console.error("[api] Unhandled request error", {
    type: error instanceof Error ? error.name : typeof error,
  });
  return apiFailure(500, "INTERNAL_ERROR", "An unexpected error occurred");
}
