import { describe, expect, it } from "vitest";

import { demoEntries } from "@/lib/demo/data";
import { ENTRY_PLACEHOLDER_IMAGES, getEntryPlaceholderImage } from "@/lib/ui/entry-placeholders";

describe("entry placeholders", () => {
  it("keeps the demo's twelve unique local SVG assets as the shared fallback palette", () => {
    expect(ENTRY_PLACEHOLDER_IMAGES).toHaveLength(12);
    expect(new Set(ENTRY_PLACEHOLDER_IMAGES).size).toBe(12);
    expect(ENTRY_PLACEHOLDER_IMAGES.every((path) => /^\/demo\/[a-z-]+\.svg$/.test(path))).toBe(
      true,
    );
    expect(demoEntries.map((entry) => entry.image)).toEqual([...ENTRY_PLACEHOLDER_IMAGES]);
  });

  it("selects deterministically and can reach every bundled placeholder", () => {
    const key = "00000000-0000-4000-8000-000000000401";
    expect(getEntryPlaceholderImage(key)).toBe(getEntryPlaceholderImage(key));

    const selected = new Set(
      Array.from({ length: 1_000 }, (_, index) => getEntryPlaceholderImage(`entry-${index}`)),
    );
    expect(selected).toEqual(new Set(ENTRY_PLACEHOLDER_IMAGES));
  });
});
