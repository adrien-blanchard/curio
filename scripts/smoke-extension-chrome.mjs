import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium } from "@playwright/test";

import { deriveChromeExtensionId, EXTENSION_DIRECTORY } from "./build-extension.mjs";

async function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue to the next supported browser location.
    }
  }
  throw new Error("Chrome was not found. Set CHROME_EXECUTABLE_PATH and retry.");
}

const chromeExecutable = await firstExistingPath([
  process.env.CHROME_EXECUTABLE_PATH,
  chromium.executablePath(),
  process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : undefined,
  process.platform === "win32"
    ? "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    : undefined,
  process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined,
  process.platform === "linux" ? "/usr/bin/google-chrome" : undefined,
]);

const manifest = JSON.parse(await fs.readFile(path.join(EXTENSION_DIRECTORY, "manifest.json")));
const extensionId = deriveChromeExtensionId(manifest.key);
const curioOrigin = process.env.CURIO_EXTENSION_SMOKE_ORIGIN?.trim() || "http://localhost:3000";
const runInteractiveConnection = process.env.CURIO_EXTENSION_LIVE_SMOKE === "1";
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "curio-extension-smoke-"));

let context;
try {
  context = await chromium.launchPersistentContext(temporaryRoot, {
    executablePath: chromeExecutable,
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIRECTORY}`,
      `--load-extension=${EXTENSION_DIRECTORY}`,
      "--window-position=-10000,-10000",
    ],
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const runtime = await page.evaluate(() => ({
    id: chrome.runtime.id,
    version: chrome.runtime.getManifest().version,
  }));
  if (runtime.id !== extensionId || runtime.version !== manifest.version) {
    throw new Error("Chrome loaded a different extension identity or version.");
  }

  await page.evaluate(async () => {
    await chrome.storage.local.set({
      session: {
        access_token: "synthetic-legacy-access-token",
        refresh_token: "synthetic-legacy-refresh-token",
        user: { id: "synthetic-legacy-user" },
      },
    });
  });

  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.locator("#setup-panel:not([hidden])").waitFor();
  const stored = await page.evaluate(async () => chrome.storage.local.get(null));
  if (Object.hasOwn(stored, "session")) {
    throw new Error("The legacy Supabase session was not purged on startup.");
  }

  if (runInteractiveConnection) {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.locator("#instance-url").fill(curioOrigin);
    await page
      .locator("#personal-token")
      .fill("curio_intentionally_invalid_connection_key_for_cors_smoke");
    await page.locator("#save-settings").click();
    await page.locator("#settings-status:not([hidden])").waitFor({ timeout: 60_000 });
    const statusText = (await page.locator("#settings-status").textContent())?.trim() ?? "";
    if (statusText !== "The connection key is invalid or has been revoked.") {
      throw new Error(`Unexpected Curio verification result: ${statusText || "no status"}`);
    }
  }

  process.stdout.write(
    `${JSON.stringify({ extensionId, legacySessionPurged: true, version: runtime.version })}\n`,
  );
} finally {
  await context?.close();
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  const resolvedSystemTemp = path.resolve(os.tmpdir());
  if (!resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}curio-extension-smoke-`)) {
    throw new Error("Refusing to remove an unexpected Chrome smoke-test directory.");
  }
  await fs.rm(resolvedTemporaryRoot, { recursive: true, force: true });
}
