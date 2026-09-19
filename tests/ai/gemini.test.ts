import { beforeEach, describe, expect, it, vi } from "vitest";

const createInteraction = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    interactions = {
      create: (...args: unknown[]) => createInteraction(...args),
    };
  },
}));

import {
  GEMINI_REQUEST_TIMEOUT_MS,
  GeminiAnalysisError,
  analyzePublicResource,
  mapGeminiError,
} from "@/lib/ai/gemini";

const tags = [{ id: "10000000-0000-4000-8000-000000000001", name: "Research", slug: "research" }];

describe("Gemini resource analysis", () => {
  beforeEach(() => createInteraction.mockReset());

  it("uses URL Context and validates structured output", async () => {
    createInteraction.mockResolvedValue({
      output_text: JSON.stringify({
        title: "A useful technical resource",
        tldr: "This fictional resource explains a reproducible technical method and its practical tradeoffs.",
        suggested_tag_slugs: ["research"],
      }),
      steps: [
        {
          type: "url_context_result",
          result: [{ url: "https://example.com/article", status: "success" }],
        },
      ],
    });

    await expect(
      analyzePublicResource({
        url: "https://example.com/article",
        tags,
        apiKey: "test-key",
        model: "gemini-3.1-flash-lite",
      }),
    ).resolves.toMatchObject({
      title: "A useful technical resource",
    });
    expect(createInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{ type: "url_context" }],
        store: false,
        response_format: expect.objectContaining({ mime_type: "application/json" }),
      }),
      {
        maxRetries: 0,
        timeout: GEMINI_REQUEST_TIMEOUT_MS,
      },
    );
  });

  it("allows an analysis with no relevant taxonomy tag", async () => {
    createInteraction.mockResolvedValue({
      output_text: JSON.stringify({
        title: "A useful technical resource",
        tldr: "This fictional resource explains a reproducible technical method that does not fit the available taxonomy.",
        suggested_tag_slugs: [],
      }),
      steps: [
        {
          type: "url_context_result",
          result: [{ url: "https://example.com/article", status: "success" }],
        },
      ],
    });

    await expect(
      analyzePublicResource({
        url: "https://example.com/article",
        tags,
        apiKey: "test-key",
        model: "gemini-3.1-flash-lite",
      }),
    ).resolves.toMatchObject({ suggested_tag_slugs: [] });
  });

  it("rejects URL Context redirects", async () => {
    createInteraction.mockResolvedValue({
      output_text: "{}",
      steps: [
        {
          type: "url_context_result",
          result: [{ url: "https://other.example/article", status: "success" }],
        },
      ],
    });
    await expect(
      analyzePublicResource({
        url: "https://example.com/article",
        tags,
        apiKey: "test-key",
        model: "gemini-3.1-flash-lite",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_REDIRECT_NOT_ALLOWED", retryable: false });
  });

  it("uses direct video input for a public YouTube URL", async () => {
    createInteraction.mockResolvedValue({
      output_text: JSON.stringify({
        title: "A public technical video",
        tldr: "This fictional video introduces a practical workflow and explains the relevant engineering decisions.",
        suggested_tag_slugs: ["research"],
      }),
      steps: [],
    });
    await analyzePublicResource({
      url: "https://youtu.be/dQw4w9WgXcQ",
      tags,
      apiKey: "test-key",
      model: "gemini-3.1-flash-lite",
    });
    expect(createInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: undefined,
        input: expect.arrayContaining([
          expect.objectContaining({ type: "video", uri: expect.stringContaining("youtube.com") }),
        ]),
      }),
      {
        maxRetries: 0,
        timeout: GEMINI_REQUEST_TIMEOUT_MS,
      },
    );
  });

  it("classifies the provider request timeout as a retryable typed failure", () => {
    const mapped = mapGeminiError({
      message: "Request timed out while contacting the provider.",
      name: "APIConnectionTimeoutError",
    });
    expect({ code: mapped.code, message: mapped.message, name: mapped.name }).toEqual({
      code: "GEMINI_REQUEST_TIMEOUT",
      message: "Gemini did not respond within 120 seconds.",
      name: "GeminiAnalysisError",
    });
    expect(mapped.retryable).toBe(true);
  });

  it("maps a provider timeout through the public analysis boundary", async () => {
    createInteraction.mockImplementationOnce(async () => {
      const timeout = new Error("Request timed out while contacting the provider.");
      timeout.name = "APIConnectionTimeoutError";
      throw timeout;
    });

    await expect(
      analyzePublicResource({
        url: "https://example.com/article",
        tags,
        apiKey: "test-key",
        model: "gemini-3.1-flash-lite",
      }),
    ).rejects.toMatchObject({
      code: "GEMINI_REQUEST_TIMEOUT",
      message: "Gemini did not respond within 120 seconds.",
      retryable: true,
    });
  });

  it("classifies a schema violation as retryable invalid model output", async () => {
    createInteraction.mockResolvedValue({
      output_text: JSON.stringify({
        title: "Too short",
        tldr: "Not enough detail.",
        suggested_tag_slugs: ["unknown-tag"],
      }),
      steps: [
        {
          type: "url_context_result",
          result: [{ url: "https://example.com/article", status: "success" }],
        },
      ],
    });

    await expect(
      analyzePublicResource({
        url: "https://example.com/article",
        tags,
        apiKey: "test-key",
        model: "gemini-3.1-flash-lite",
      }),
    ).rejects.toMatchObject({ code: "AI_OUTPUT_INVALID", retryable: true });
  });

  it("uses a typed, non-sensitive error for rejected redirects", async () => {
    createInteraction.mockResolvedValue({
      output_text: "{}",
      steps: [
        {
          type: "url_context_result",
          result: [{ url: "https://redirect.example/article", status: "success" }],
        },
      ],
    });
    try {
      await analyzePublicResource({
        url: "https://example.com/article",
        tags,
        apiKey: "test-key",
        model: "gemini-3.1-flash-lite",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(GeminiAnalysisError);
      expect((error as GeminiAnalysisError).message).not.toContain("test-key");
    }
  });
});
