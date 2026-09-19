import { describe, expect, it } from "vitest";
import { analysisResultSchema } from "@/lib/ai/schemas";

const content = {
  title: "A public resource",
  tldr: "A detailed summary of the resource and its technical approach.",
  suggested_tag_slugs: [],
};
describe("source date extraction", () => {
  it("accepts explicit dates and keeps old worker responses compatible", () => {
    expect(
      analysisResultSchema.parse({
        ...content,
        source_published_at: "2026-01-01",
        source_date_kind: "released",
      }).source_published_at,
    ).toBe("2026-01-01");
    expect(analysisResultSchema.parse(content).source_published_at).toBeNull();
  });
  it.each(["2026-02-30", "2999-01-01", "July 2026", "2026"])(
    "drops unreliable date %s without failing the summary",
    (date) => {
      expect(
        analysisResultSchema.parse({ ...content, source_published_at: date }).source_published_at,
      ).toBeNull();
    },
  );
});
