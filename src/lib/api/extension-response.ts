import { ApiError } from "./response";
import { allowedExtensionOrigin, extensionCorsHeaders, withCors } from "./cors";

export function prepareExtensionResponse(request: Request, methods: readonly string[]): Headers {
  const origin = request.headers.get("origin");
  if (origin?.toLowerCase().startsWith("chrome-extension://")) {
    if (!allowedExtensionOrigin(request)) {
      throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "Extension origin is not allowed");
    }
  }
  return extensionCorsHeaders(request, methods);
}

export function extensionResponse(response: Response, headers: Headers) {
  return withCors(response, headers);
}
