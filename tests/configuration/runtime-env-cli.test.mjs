import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(repositoryRoot, "scripts", "validate-runtime-env.mjs");
const validEnvironment = {
  NEXT_PUBLIC_APP_NAME: "Curio",
  NEXT_PUBLIC_ORGANIZATION_NAME: "Example",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_DEMO_ENABLED: "true",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anonymous-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  API_TOKEN_PEPPER: "test-pepper-value-with-at-least-32-characters",
  ALLOWED_EMAIL_ADDRESSES: "",
  ALLOWED_EMAIL_DOMAINS: "example.test",
  DEFAULT_USER_ROLE: "contributor",
  INITIAL_ADMIN_EMAILS: "admin@example.test",
  GEMINI_API_KEY: "test-gemini-key",
  GEMINI_MODEL: "synthetic-model",
  THUMBNAIL_PROVIDER: "none",
  MICROLINK_API_KEY: "",
  EXTENSION_ENABLED: "false",
  ALLOWED_EXTENSION_IDS: "",
  NEXT_PUBLIC_EXTENSION_INSTALL_URL: "",
  PRIVACY_CONTACT_EMAIL: "privacy@example.test",
  VERCEL: "",
};

function run(overrides = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: repositoryRoot,
    env: { ...process.env, ...validEnvironment, ...overrides },
    encoding: "utf8",
  });
}

describe("production build environment validator", () => {
  it("accepts a complete local verification environment", () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Production build environment validated");
  });

  it("rejects an unsupported thumbnail provider", () => {
    const result = run({ THUMBNAIL_PROVIDER: "arbitrary-proxy" });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("THUMBNAIL_PROVIDER");
  });

  it("accepts an exact-address-only allowlist case-insensitively", () => {
    const result = run({
      ALLOWED_EMAIL_ADDRESSES: "Personal.User@GMAIL.COM",
      ALLOWED_EMAIL_DOMAINS: "",
      INITIAL_ADMIN_EMAILS: "personal.user@gmail.com",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Production build environment validated");
  });

  it("requires at least one exact address or domain", () => {
    const result = run({ ALLOWED_EMAIL_ADDRESSES: "", ALLOWED_EMAIL_DOMAINS: "" });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("ALLOWED_EMAIL_ADDRESSES");
    expect(`${result.stdout}${result.stderr}`).toContain("ALLOWED_EMAIL_DOMAINS");
  });

  it("fails before build when a required secret is absent", () => {
    const result = run({ SUPABASE_SERVICE_ROLE_KEY: "" });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("requires non-local HTTPS origins on Vercel", () => {
    const result = run({ VERCEL: "1" });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("non-local HTTPS origin");
  });

  it("rejects a Store install URL whose ID is not allowed", () => {
    const result = run({
      EXTENSION_ENABLED: "true",
      ALLOWED_EXTENSION_IDS: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      NEXT_PUBLIC_EXTENSION_INSTALL_URL:
        "https://chromewebstore.google.com/detail/bldceafomhokgmndglcllplmnclklcdn",
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("NEXT_PUBLIC_EXTENSION_INSTALL_URL");
  });

  it.each(["127.0.0.1", "0.0.0.0", "dev.localhost", "[::1]"])(
    "rejects the local host %s on Vercel",
    (hostname) => {
      const result = run({
        VERCEL: "1",
        NEXT_PUBLIC_APP_URL: `https://${hostname}`,
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain("non-local HTTPS origin");
    },
  );

  it("rejects a bootstrap administrator outside the combined allowlist", () => {
    const result = run({
      ALLOWED_EMAIL_ADDRESSES: "member@other.test",
      INITIAL_ADMIN_EMAILS: "admin@other.test",
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("INITIAL_ADMIN_EMAILS");
  });
});
