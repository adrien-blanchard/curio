import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backendFreeEnvironment = {
  NEXT_PUBLIC_APP_NAME: "Curio",
  NEXT_PUBLIC_ORGANIZATION_NAME: "Synthetic test instance",
  NEXT_PUBLIC_APP_URL: "",
  NEXT_PUBLIC_DEMO_ENABLED: "true",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  ALLOWED_EMAIL_DOMAINS: "",
  DEFAULT_USER_ROLE: "contributor",
  INITIAL_ADMIN_EMAILS: "",
  EXTENSION_ENABLED: "false",
  ALLOWED_EXTENSION_IDS: "",
  PRIVACY_CONTACT_EMAIL: "",
  API_TOKEN_PEPPER: "",
  GEMINI_API_KEY: "",
  GEMINI_MODEL: "",
};

describe("GET /api/v1/meta", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const [name, value] of Object.entries(backendFreeEnvironment)) vi.stubEnv(name, value);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns a safe capability envelope without backend credentials", async () => {
    const { GET } = await import("@/app/api/v1/meta/route");
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await response.json()).toEqual({
      data: {
        name: "Curio",
        organization: "Synthetic test instance",
      },
      error: null,
    });
  });
});
