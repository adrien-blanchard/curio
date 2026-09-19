import { z } from "zod";

const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

export const optionalString = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());

export const httpUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "must use the http or https protocol");

export const optionalUrl = z.preprocess(emptyToUndefined, httpUrl.optional());

export const booleanFromEnvironment = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean().default(false));

export function commaSeparatedValues(value: unknown): string[] {
  if (typeof value !== "string") return [];

  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export class EnvironmentValidationError extends Error {
  readonly issues: readonly string[];

  constructor(scope: string, error: z.ZodError) {
    const issues = error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "environment";
      return `${path}: ${issue.message}`;
    });

    super(`Invalid ${scope} environment configuration: ${issues.join("; ")}`);
    this.name = "EnvironmentValidationError";
    this.issues = issues;
  }
}

export function parseEnvironment<T>(scope: string, schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new EnvironmentValidationError(scope, result.error);
  }

  return result.data;
}
