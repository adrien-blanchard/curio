import { NextResponse } from "next/server";
import { getAuthEnv } from "@/lib/env/server";
import { apiFailure } from "./response";

export function allowedExtensionOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  const environment = getAuthEnv();
  if (!environment.EXTENSION_ENABLED) return null;

  const match = /^chrome-extension:\/\/([a-p]{32})$/i.exec(origin);
  if (!match) return null;
  const extensionId = match[1].toLowerCase();
  return environment.ALLOWED_EXTENSION_IDS.includes(extensionId)
    ? `chrome-extension://${extensionId}`
    : null;
}

export function extensionCorsHeaders(request: Request, methods: readonly string[]) {
  const origin = allowedExtensionOrigin(request);
  if (!origin) return new Headers();

  const headers = new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": methods.join(", "),
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
  return headers;
}

export function extensionPreflight(request: Request, methods: readonly string[]) {
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && !allowedExtensionOrigin(request)) {
    return apiFailure(403, "ORIGIN_NOT_ALLOWED", "Extension origin is not allowed");
  }
  return new NextResponse(null, {
    status: 204,
    headers: extensionCorsHeaders(request, methods),
  });
}

export function withCors(response: Response, headers: Headers) {
  for (const [name, value] of headers) response.headers.set(name, value);
  return response;
}
