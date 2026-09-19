import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflowSource = readFileSync(
  resolve(process.cwd(), "src/workflows/process-entry.ts"),
  "utf8",
);

const serverOnlyStepDependencies = [
  "@/lib/ai/gemini",
  "@/lib/env/server",
  "@/lib/images/thumbnails",
  "@/lib/supabase/server",
];

describe("workflow import boundaries", () => {
  it("keeps Node and server-only dependencies outside the workflow sandbox bundle", () => {
    const staticImports = [
      ...workflowSource.matchAll(/^import[\s\S]*?from\s+["']([^"']+)["'];/gmu),
    ].map(([, specifier]) => specifier);

    for (const specifier of serverOnlyStepDependencies) {
      expect(staticImports).not.toContain(specifier);
      expect(workflowSource).toContain(`import("${specifier}")`);
    }
  });

  it("keeps the workflow-level thumbnail path helper dependency-free", () => {
    const helperSource = readFileSync(
      resolve(process.cwd(), "src/lib/images/workflow-thumbnail-path.ts"),
      "utf8",
    );

    expect(helperSource).not.toMatch(/^import\s/mu);
    expect(helperSource).not.toMatch(/(?:node:|server-only)/u);
  });

  it("does not replay the provider-and-storage thumbnail step automatically", () => {
    expect(workflowSource).toContain("createAndStoreThumbnail.maxRetries = 0");
  });
});
