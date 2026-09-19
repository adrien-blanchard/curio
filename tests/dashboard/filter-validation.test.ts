import { describe, expect, it } from "vitest";

import { dashboardTagSlugSchema, parseDashboardTagSlugs } from "@/lib/dashboard/filter-validation";

describe("dashboard filter validation", () => {
  it("matches the database's 80-character tag slug limit", () => {
    const maximumSlug = "a".repeat(80);
    const oversizedSlug = "b".repeat(81);

    expect(dashboardTagSlugSchema.safeParse(maximumSlug).success).toBe(true);
    expect(dashboardTagSlugSchema.safeParse(oversizedSlug).success).toBe(false);
    expect(parseDashboardTagSlugs(`research,${oversizedSlug},${maximumSlug}`)).toEqual([
      "research",
      maximumSlug,
    ]);
  });

  it("normalizes, deduplicates, and caps selected tags", () => {
    expect(parseDashboardTagSlugs(" Research,ai,AI,bad slug,3d,tools,video,extra ")).toEqual([
      "research",
      "ai",
      "3d",
      "tools",
      "video",
    ]);
  });
});
