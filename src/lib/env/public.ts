import { z } from "zod";
import { booleanFromEnvironment, optionalString, optionalUrl, parseEnvironment } from "./shared";

const publicEnvironmentSchema = z
  .object({
    NEXT_PUBLIC_APP_NAME: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.string().trim().min(1).default("Curio"),
    ),
    NEXT_PUBLIC_ORGANIZATION_NAME: z.preprocess(
      (value) => (typeof value === "string" ? value.trim() : value),
      z.string().default(""),
    ),
    NEXT_PUBLIC_APP_URL: optionalUrl,
    NEXT_PUBLIC_DEMO_ENABLED: booleanFromEnvironment.default(false),
    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  })
  .superRefine((environment, context) => {
    const hasUrl = Boolean(environment.NEXT_PUBLIC_SUPABASE_URL);
    const hasKey = Boolean(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY);

    if (hasUrl !== hasKey) {
      context.addIssue({
        code: "custom",
        path: hasUrl ? ["NEXT_PUBLIC_SUPABASE_ANON_KEY"] : ["NEXT_PUBLIC_SUPABASE_URL"],
        message: "Supabase URL and anonymous key must be configured together",
      });
    }
  });

export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;

let cachedPublicEnvironment: PublicEnvironment | undefined;

function publicEnvironmentInput() {
  // Keep direct references so Next.js can inline NEXT_PUBLIC_* values in client bundles.
  return {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_ORGANIZATION_NAME: process.env.NEXT_PUBLIC_ORGANIZATION_NAME,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_DEMO_ENABLED: process.env.NEXT_PUBLIC_DEMO_ENABLED,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/**
 * Lazily validates public metadata. Supabase is optional here so the isolated
 * demo can be built and rendered without backend credentials.
 */
export function getPublicEnv(): PublicEnvironment {
  cachedPublicEnvironment ??= parseEnvironment(
    "public",
    publicEnvironmentSchema,
    publicEnvironmentInput(),
  );
  return cachedPublicEnvironment;
}

export type PublicSupabaseEnvironment = PublicEnvironment & {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
};

/** Fail fast only when a caller genuinely needs Supabase. */
export function getPublicSupabaseEnv(): PublicSupabaseEnvironment {
  const environment = getPublicEnv();
  if (!environment.NEXT_PUBLIC_SUPABASE_URL || !environment.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required",
    );
  }

  return environment as PublicSupabaseEnvironment;
}

export function isBackendConfigured(): boolean {
  try {
    const environment = getPublicEnv();
    return Boolean(
      environment.NEXT_PUBLIC_SUPABASE_URL && environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  } catch {
    return false;
  }
}
