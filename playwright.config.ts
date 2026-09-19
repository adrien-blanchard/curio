import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? "3100", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PLAYWRIGHT_PORT must be a valid TCP port.");
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

/**
 * These smoke tests deliberately exercise the public, backend-free mode. Empty
 * values override a developer's local environment so no provider credential is
 * inherited by the child Next.js process.
 */
const backendFreeEnvironment = {
  NEXT_PUBLIC_APP_NAME: "Curio",
  NEXT_PUBLIC_ORGANIZATION_NAME: "Synthetic test instance",
  NEXT_PUBLIC_APP_URL: baseURL,
  NEXT_PUBLIC_DEMO_ENABLED: "true",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  API_TOKEN_PEPPER: "",
  ALLOWED_EMAIL_DOMAINS: "",
  DEFAULT_USER_ROLE: "contributor",
  INITIAL_ADMIN_EMAILS: "",
  GEMINI_API_KEY: "",
  GEMINI_MODEL: "gemini-3.1-flash-lite",
  EXTENSION_ENABLED: "false",
  ALLOWED_EXTENSION_IDS: "",
  PRIVACY_CONTACT_EMAIL: "",
};

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  expect: { timeout: 5_000 },
  use: {
    baseURL,
    locale: "en-GB",
    timezoneId: "UTC",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/demo`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: backendFreeEnvironment,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
