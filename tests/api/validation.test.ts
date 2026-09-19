import { z } from "zod";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/response";
import { MAX_JSON_BODY_BYTES, parseJsonBody } from "@/lib/api/validation";

const payloadSchema = z.strictObject({
  name: z.string().trim().min(1).max(20),
  scopes: z.array(z.enum(["profile:read", "tags:read"])).min(1),
});

describe("JSON request parsing", () => {
  it("rejects media types that only start with application/json", async () => {
    const request = new Request("https://curio.example.test/api", {
      method: "POST",
      headers: { "Content-Type": "application/json-invalid" },
      body: "{}",
    });
    await expect(parseJsonBody(request, z.unknown())).rejects.toMatchObject({ status: 415 });
  });

  it("rejects an oversized declared body before reading", async () => {
    const request = new Request("https://curio.example.test/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(MAX_JSON_BODY_BYTES + 1),
      },
      body: "{}",
    });
    await expect(parseJsonBody(request, z.unknown())).rejects.toMatchObject({
      status: 413,
      code: "BODY_TOO_LARGE",
    });
    expect(request.bodyUsed).toBe(false);
  });

  it.each([undefined, "2"])("bounds real bytes despite Content-Length %s", async (length) => {
    const request = new Request("https://curio.example.test/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(length ? { "Content-Length": length } : {}),
      },
      // Multibyte characters must count as bytes, not JavaScript characters.
      body: JSON.stringify("é".repeat(MAX_JSON_BODY_BYTES / 2)),
    });
    await expect(parseJsonBody(request, z.string())).rejects.toMatchObject({
      status: 413,
      code: "BODY_TOO_LARGE",
    });
  });

  it("accepts a body exactly at the byte limit", async () => {
    const value = "a".repeat(MAX_JSON_BODY_BYTES - 2);
    const request = new Request("https://curio.example.test/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    await expect(parseJsonBody(request, z.string())).resolves.toBe(value);
  });

  it("accepts JSON with a charset and returns the schema output", async () => {
    const request = new Request("https://curio.example.test/api", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ name: "  Browser token  ", scopes: ["profile:read"] }),
    });
    await expect(parseJsonBody(request, payloadSchema)).resolves.toEqual({
      name: "Browser token",
      scopes: ["profile:read"],
    });
  });

  it("rejects a body without the JSON media type before parsing it", async () => {
    const request = new Request("https://curio.example.test/api", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    });
    const error = await parseJsonBody(request, payloadSchema).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  it("distinguishes malformed JSON from a schema-invalid JSON value", async () => {
    const malformed = new Request("https://curio.example.test/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    const malformedError = await parseJsonBody(malformed, payloadSchema).catch(
      (reason: unknown) => reason,
    );
    expect(malformedError).toBeInstanceOf(ApiError);
    expect(malformedError).toMatchObject({ status: 400, code: "INVALID_JSON" });

    const unknownProperty = new Request("https://curio.example.test/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Browser token",
        scopes: ["profile:read"],
        administrator: true,
      }),
    });
    await expect(parseJsonBody(unknownProperty, payloadSchema)).rejects.toBeInstanceOf(z.ZodError);
  });
});
