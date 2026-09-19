import { z } from "zod";
import { ApiError } from "./response";

export const MAX_JSON_BODY_BYTES = 64 * 1024;

function bodyTooLarge() {
  return new ApiError(413, "BODY_TOO_LARGE", "JSON request body exceeds the 64 KiB limit");
}

async function readJsonBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_JSON_BODY_BYTES) {
    throw bodyTooLarge();
  }
  if (!request.body) throw new SyntaxError("Missing JSON body");

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_JSON_BODY_BYTES) {
        // Do not await cancellation: a producer can stall it indefinitely.
        void reader.cancel().catch(() => undefined);
        throw bodyTooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}

export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0].trim() !== "application/json") {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON");
  }

  return schema.parse(body);
}
