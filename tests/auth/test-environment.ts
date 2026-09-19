import { vi } from "vitest";

const VALID_AUTH_ENVIRONMENT = {
  NEXT_PUBLIC_APP_NAME: "Curio",
  NEXT_PUBLIC_ORGANIZATION_NAME: "Synthetic test instance",
  NEXT_PUBLIC_APP_URL: "https://curio.example.test",
  NEXT_PUBLIC_DEMO_ENABLED: "true",
  NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anonymous-key",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role-key",
  ALLOWED_EMAIL_DOMAINS: "example.test,second.example.test",
  ALLOWED_EMAIL_ADDRESSES: "",
  DEFAULT_USER_ROLE: "contributor",
  INITIAL_ADMIN_EMAILS: "admin@example.test",
  EXTENSION_ENABLED: "false",
  ALLOWED_EXTENSION_IDS: "",
  PRIVACY_CONTACT_EMAIL: "privacy@example.test",
  API_TOKEN_PEPPER: "test-pepper-".repeat(4),
  GEMINI_API_KEY: ["synthetic", "gemini", "key"].join("-"),
  GEMINI_MODEL: "gemini-3.1-flash-lite",
} as const;

export function stubValidAuthEnvironment(overrides: Record<string, string> = {}) {
  for (const [name, value] of Object.entries({ ...VALID_AUTH_ENVIRONMENT, ...overrides })) {
    vi.stubEnv(name, value);
  }
}
