import { afterEach, describe, expect, it, vi } from "vitest";

const validAuthenticationEnvironment = {
  NODE_ENV: "development",
  NEXT_PUBLIC_APP_NAME: "Curio",
  NEXT_PUBLIC_ORGANIZATION_NAME: "Example",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_DEMO_ENABLED: "true",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anonymous-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  ALLOWED_EMAIL_DOMAINS: "example.test",
  ALLOWED_EMAIL_ADDRESSES: "",
  DEFAULT_USER_ROLE: "contributor",
  INITIAL_ADMIN_EMAILS: "admin@example.test",
  EXTENSION_ENABLED: "false",
  ALLOWED_EXTENSION_IDS: "",
  NEXT_PUBLIC_EXTENSION_INSTALL_URL: "",
  THUMBNAIL_PROVIDER: "",
  MICROLINK_API_KEY: "",
  PRIVACY_CONTACT_EMAIL: "privacy@example.test",
  API_TOKEN_PEPPER: "test-pepper-value-with-at-least-32-characters",
} as const;

async function authenticationEnvironment(overrides: Record<string, string> = {}) {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    ...validAuthenticationEnvironment,
    ...overrides,
  })) {
    vi.stubEnv(name, value);
  }
  const { getAuthEnv } = await import("@/lib/env/server");
  return getAuthEnv();
}

async function serverEnvironment(overrides: Record<string, string> = {}) {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    ...validAuthenticationEnvironment,
    GEMINI_API_KEY: "test-gemini-key",
    GEMINI_MODEL: "gemini-3.1-flash-lite",
    ...overrides,
  })) {
    vi.stubEnv(name, value);
  }
  const { getServerEnv } = await import("@/lib/env/server");
  return getServerEnv();
}

describe("environment validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(["0", "false", "no", "off"])(
    "parses %s as a disabled public demo flag",
    async (value) => {
      vi.resetModules();
      vi.stubEnv("NEXT_PUBLIC_DEMO_ENABLED", value);
      const { getPublicEnv } = await import("@/lib/env/public");
      expect(getPublicEnv().NEXT_PUBLIC_DEMO_ENABLED).toBe(false);
    },
  );

  it("requires a bootstrap administrator for a configured backend", async () => {
    await expect(authenticationEnvironment({ INITIAL_ADMIN_EMAILS: "" })).rejects.toThrow(
      "INITIAL_ADMIN_EMAILS",
    );
  });

  it("requires at least one allowed email address or domain", async () => {
    await expect(
      authenticationEnvironment({
        ALLOWED_EMAIL_DOMAINS: "",
        ALLOWED_EMAIL_ADDRESSES: "",
      }),
    ).rejects.toThrow("ALLOWED_EMAIL_ADDRESSES");
  });

  it("accepts and normalizes an exact-address-only allowlist", async () => {
    await expect(
      authenticationEnvironment({
        ALLOWED_EMAIL_DOMAINS: "",
        ALLOWED_EMAIL_ADDRESSES: " Admin@Example.Test , admin@example.test ",
        INITIAL_ADMIN_EMAILS: "ADMIN@example.test",
      }),
    ).resolves.toMatchObject({
      ALLOWED_EMAIL_DOMAINS: [],
      ALLOWED_EMAIL_ADDRESSES: ["admin@example.test"],
      INITIAL_ADMIN_EMAILS: ["admin@example.test"],
    });
  });

  it("requires each initial administrator to match an exact address or allowed domain", async () => {
    await expect(
      authenticationEnvironment({
        ALLOWED_EMAIL_DOMAINS: "members.example.test",
        ALLOWED_EMAIL_ADDRESSES: "invited@example.test",
        INITIAL_ADMIN_EMAILS: "other@example.test",
      }),
    ).rejects.toThrow("INITIAL_ADMIN_EMAILS");
  });

  it.each([
    ["a non-HTTP application URL", "javascript:alert(1)"],
    ["an application subpath", "https://curio.example.test/app"],
  ])("rejects %s", async (_label, applicationUrl) => {
    await expect(
      authenticationEnvironment({ NEXT_PUBLIC_APP_URL: applicationUrl }),
    ).rejects.toThrow("NEXT_PUBLIC_APP_URL");
  });

  it("requires non-local HTTPS origins in production", async () => {
    await expect(
      authenticationEnvironment({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).rejects.toThrow("non-local HTTPS origin");
  });

  it("accepts explicit local development origins", async () => {
    await expect(authenticationEnvironment()).resolves.toMatchObject({
      APP_ORIGIN: "http://localhost:3000",
      ALLOWED_EMAIL_ADDRESSES: [],
      INITIAL_ADMIN_EMAILS: ["admin@example.test"],
    });
  });

  it("accepts only a matching Chrome Web Store install URL when extensions are enabled", async () => {
    const extensionId = "bldceafomhokgmndglcllplmnclklcdn";
    await expect(
      authenticationEnvironment({
        EXTENSION_ENABLED: "true",
        ALLOWED_EXTENSION_IDS: extensionId,
        NEXT_PUBLIC_EXTENSION_INSTALL_URL: `https://chromewebstore.google.com/detail/${extensionId}`,
      }),
    ).resolves.toMatchObject({ NEXT_PUBLIC_EXTENSION_INSTALL_URL: expect.any(String) });

    await expect(
      authenticationEnvironment({
        EXTENSION_ENABLED: "true",
        ALLOWED_EXTENSION_IDS: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        NEXT_PUBLIC_EXTENSION_INSTALL_URL: `https://chromewebstore.google.com/detail/${extensionId}`,
      }),
    ).rejects.toThrow("NEXT_PUBLIC_EXTENSION_INSTALL_URL");
  });

  it("defaults generic previews off and accepts an optional Microlink configuration", async () => {
    await expect(serverEnvironment()).resolves.toMatchObject({
      THUMBNAIL_PROVIDER: "none",
      MICROLINK_API_KEY: undefined,
    });
    await expect(
      serverEnvironment({
        THUMBNAIL_PROVIDER: "microlink",
        MICROLINK_API_KEY: " test-microlink-key ",
      }),
    ).resolves.toMatchObject({
      THUMBNAIL_PROVIDER: "microlink",
      MICROLINK_API_KEY: "test-microlink-key",
    });
  });
});
