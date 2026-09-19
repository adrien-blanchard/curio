import { describe, expect, it } from "vitest";

import {
  hasProcessingFailureCode,
  processingTerminalFailureInfo,
  workflowFailureInfo,
} from "@/lib/workflows/errors";

describe("processingTerminalFailureInfo", () => {
  it("classifies a Supabase timeout fence without exposing database diagnostics", () => {
    expect(
      processingTerminalFailureInfo({
        code: "P0001",
        details: "private diagnostic details",
        message: "PROCESSING_TIMEOUT",
      }),
    ).toEqual({
      code: "PROCESSING_TIMEOUT",
      message: "Processing stopped after 15 minutes without progress. Retry to try again.",
    });
  });

  it("classifies an attempt that another worker already completed", () => {
    expect(processingTerminalFailureInfo(new Error("RPC: PROCESSING_ATTEMPT_TERMINAL"))).toEqual({
      code: "PROCESSING_ATTEMPT_TERMINAL",
      message: "This processing attempt has already finished.",
    });
  });

  it("ignores unrelated database failures", () => {
    expect(processingTerminalFailureInfo({ message: "connection refused" })).toBeNull();
  });

  it("recognizes only a delimited duplicate-attempt marker", () => {
    expect(
      hasProcessingFailureCode(
        { message: "RPC: PROCESSING_ATTEMPT_ACTIVE" },
        "PROCESSING_ATTEMPT_ACTIVE",
      ),
    ).toBe(true);
    expect(
      hasProcessingFailureCode(
        { message: "NOT_PROCESSING_ATTEMPT_ACTIVE_SUFFIX" },
        "PROCESSING_ATTEMPT_ACTIVE",
      ),
    ).toBe(false);
  });
});

describe("workflowFailureInfo", () => {
  it("preserves a stable step error marker after Workflow runtime context", () => {
    expect(
      workflowFailureInfo(
        new Error(
          'Step "analyzeEntry" failed after 5 retries: GEMINI_QUOTA_EXCEEDED|Gemini is rate limited.',
        ),
      ),
    ).toEqual({
      code: "GEMINI_QUOTA_EXCEEDED",
      message: "Gemini is rate limited.",
    });
  });

  it("preserves a stable marker from an error crossing the Workflow VM boundary", () => {
    expect(
      workflowFailureInfo({
        message: "SOURCE_RETRIEVAL_FAILED|Gemini could not retrieve the public resource.",
      }),
    ).toEqual({
      code: "SOURCE_RETRIEVAL_FAILED",
      message: "Gemini could not retrieve the public resource.",
    });
  });

  it("never persists raw diagnostics when no stable marker is present", () => {
    expect(
      workflowFailureInfo(
        new Error("Authorization: Bearer private-token for https://secret.example.test"),
      ),
    ).toEqual({
      code: "PIPELINE_FAILED",
      message: "Processing failed unexpectedly.",
    });
  });
});
