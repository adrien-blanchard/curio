import "server-only";

import { getAuthEnv } from "@/lib/env/server";
import { AuthenticationError } from "./errors";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function assertCsrfOrigin(request: Request) {
  if (safeMethods.has(request.method.toUpperCase())) return;

  const origin = request.headers.get("origin");
  const expectedOrigin = getAuthEnv().APP_ORIGIN;

  let normalizedOrigin: string | null = null;
  try {
    normalizedOrigin = origin ? new URL(origin).origin : null;
  } catch {
    normalizedOrigin = null;
  }

  if (normalizedOrigin !== expectedOrigin) {
    throw new AuthenticationError("CSRF_ORIGIN_MISMATCH", "Request origin is not allowed", 403);
  }
}
