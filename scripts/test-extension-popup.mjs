import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { startStaticServer, installChromeMocks } from "./capture-extension-store-assets.mjs";

// Real popup DOM and browser interaction; synthetic API only, no account data or writes.
const { server, origin } = await startStaticServer();
const browser = await chromium.launch();
await mkdir("artifacts/extension-popup", { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 600 } });
  await installChromeMocks(page, { connected: true });
  await page.addInitScript(() => {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (new URL(String(input)).pathname === "/api/v1/tags") {
        const names = [
          "3D",
          "Agentic",
          "Audio",
          "Gaussian Splatting",
          "Image Editing",
          "Image Generation",
          "LLM / Text",
          "Real-Time",
          "Relighting & AOVs",
          "Robotics",
          "Video Editing",
          "World Generation",
        ];
        return new Response(
          JSON.stringify({
            data: {
              tags: names.map((name, i) => ({
                id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
                name,
              })),
            },
          }),
          { status: 200 },
        );
      }
      if (new URL(String(input)).pathname === "/api/v1/entries") {
        globalThis.lastSubmission = JSON.parse(init.body);
        if (globalThis.failSubmission)
          return new Response(
            JSON.stringify({ error: { message: "Please try again.", code: "TEST_ERROR" } }),
            { status: 503 },
          );
      }
      return original(input, init);
    };
  });
  await page.goto(origin);
  await page.locator("#entry-form:not([hidden])").waitFor();
  assert.match(await page.locator("#page-url").inputValue(), /example.com/);
  assert.equal(
    await page
      .locator('input[value="opensource"] + span')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(5, 166, 122)",
  );
  await page.getByRole("radio", { name: "Proprietary", exact: true }).check();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('input[value="proprietary"] + span'))
        .backgroundColor === "rgb(217, 72, 59)",
  );
  assert.equal(
    await page
      .locator('input[value="proprietary"] + span')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(217, 72, 59)",
  );
  await page.getByRole("radio", { name: "Open source", exact: true }).check();
  const tags = page.locator(".tag-option input");
  for (let i = 0; i < 10; i++) await tags.nth(i).check();
  // Native click rather than check: the selection cap intentionally reverts the 11th checkbox.
  await tags.nth(10).click();
  assert.equal(await tags.nth(10).isChecked(), false);
  assert.equal(await page.locator("#tag-count").textContent(), "10 of 10 selected");
  assert.match(await page.locator("#form-status").textContent(), /no more than 10/);
  for (let i = 1; i < 10; i++) await tags.nth(i).uncheck();
  assert.equal(await page.locator("#tag-count").textContent(), "1 of 10 selected");
  await page.locator("#page-url").focus();
  await page.waitForTimeout(200);
  await page.screenshot({ path: "artifacts/extension-popup/updated-popup.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 320, height: 600 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => (globalThis.failSubmission = true));
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#submit-entry").disabled);
  assert.equal(await page.getByRole("button", { name: "Submit", exact: true }).count(), 1);
  await page.evaluate(() => (globalThis.failSubmission = false));
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.getByText("Saved to Curio.", { exact: true }).waitFor();
  const payload = await page.evaluate(() => globalThis.lastSubmission);
  assert.equal(payload.sourceType, "opensource");
  assert.equal(payload.tagIds.length, 1);
  assert.equal(await page.getByRole("button", { name: "Saved", exact: true }).isDisabled(), true);
  console.log(
    "Popup browser checks passed: autofill, source styling, tag cap/count, overflow, error recovery and submission.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
