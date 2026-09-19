/** Source publication dates are independent of the date an entry was added to Curio. */
export const SOURCE_DATE_KINDS = [
  "published",
  "released",
  "uploaded",
  "repository_created",
] as const;
export type SourceDateKind = (typeof SOURCE_DATE_KINDS)[number];
export const SOURCE_DATE_LABELS: Record<SourceDateKind, string> = {
  published: "Publication",
  released: "Release",
  uploaded: "Video upload",
  repository_created: "Repository creation",
};

export function isValidSourceDate(value: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value <= now.toISOString().slice(0, 10)
  );
}

function anniversary(value: string, months: number): number {
  const date = new Date(`${value}T00:00:00Z`);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months + 1, 0));
  return Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    Math.min(date.getUTCDate(), end.getUTCDate()),
  );
}

export function getSourceAge(value?: string | null, now = new Date()) {
  if (!value || !isValidSourceDate(value, now)) return "unknown" as const;
  if (now.getTime() < anniversary(value, 3)) return "recent" as const;
  if (now.getTime() < anniversary(value, 6)) return "established" as const;
  return "older" as const;
}
