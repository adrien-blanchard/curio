import { z } from "zod";

import { MAX_DASHBOARD_TAG_FILTERS } from "./filter-constants";

export const dashboardTagSlugSchema = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export function parseDashboardTagSlugs(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((slug) => slug.trim().toLowerCase())
        .filter((slug) => dashboardTagSlugSchema.safeParse(slug).success),
    ),
  ].slice(0, MAX_DASHBOARD_TAG_FILTERS);
}
