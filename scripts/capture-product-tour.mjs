import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { startStaticServer, installChromeMocks } from "./capture-extension-store-assets.mjs";

// Records real Curio components with synthetic fixtures. No account or API credential is used.
const output = path.resolve("artifacts/product-tour");
const origin = process.env.CURIO_CAPTURE_ORIGIN || "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("Capture harness is local-only.");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const { server, origin: extensionOrigin } = await startStaticServer();
const captions = [];
let context;
try {
  const warmup = await browser.newPage();
  await warmup.goto(`${origin}/demo/studio`);
  await warmup.getByRole("heading", { name: "Knowledge base" }).waitFor();
  await warmup.close();
  context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: path.join(output, "raw"), size: { width: 1920, height: 1080 } },
  });
  await context.route("**/api/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { tags: [], id: "83000000-0000-4000-8000-000000000001", status: "queued" },
        error: null,
      }),
    }),
  );
  const page = await context.newPage();
  const start = Date.now();
  const caption = (text) => captions.push({ start: (Date.now() - start) / 1000, text });
  const pause = (ms) => page.waitForTimeout(ms);
  async function click(locator) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error("Capture control is not visible");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 });
    await pause(200);
    await locator.click();
  }
  async function snapshot(name) {
    await page.evaluate(() => document.getElementById("tour-cursor")?.setAttribute("hidden", ""));
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    await page.evaluate(() => document.getElementById("tour-cursor")?.removeAttribute("hidden"));
  }
  await page.addInitScript(() => {
    addEventListener("DOMContentLoaded", () => {
      const pointer = document.createElement("div");
      pointer.id = "tour-cursor";
      pointer.style.cssText =
        "position:fixed;width:18px;height:18px;border:3px solid white;border-radius:50%;background:#0075c9;box-shadow:0 1px 8px #1b254b66;pointer-events:none;z-index:999999;left:-30px;top:-30px;transform:translate(-50%,-50%)";
      document.body.append(pointer);
      addEventListener("mousemove", (event) => {
        pointer.style.left = `${event.clientX}px`;
        pointer.style.top = `${event.clientY}px`;
      });
      addEventListener("mousedown", () => {
        pointer.style.boxShadow = "0 0 0 12px #0075c933";
      });
      addEventListener("mouseup", () => {
        pointer.style.boxShadow = "0 1px 8px #1b254b66";
      });
    });
  });
  await page.goto(`${origin}/demo/studio`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal { display:none!important }" });
  caption("Curio. A shared home for tools, research and useful links.");
  await pause(1300);
  await snapshot("01-dashboard");
  await pause(2100);
  caption("Find what matters with tags, search and source filters.");
  await click(page.getByRole("button", { name: "Computer Vision", exact: true }).first());
  await pause(1800);
  await click(page.getByRole("button", { name: "Clear filters", exact: true }).first());
  await pause(600);
  await click(
    page.getByRole("button", {
      name: "View Atlas: compact models for on-device visual search",
      exact: true,
    }),
  );
  caption("Open a card for the summary, source and related topics.");
  await pause(1600);
  await snapshot("02-entry-detail");
  await pause(1800);
  caption("See source age at a glance. Edit details when needed.");
  await click(page.getByRole("button", { name: "Manage entry", exact: true }));
  await page.getByLabel("Source date", { exact: true }).scrollIntoViewIfNeeded();
  await pause(1500);
  await snapshot("03-entry-editor");
  await page.getByLabel("Source date", { exact: true }).fill("2026-08-20");
  await pause(2000);
  await click(page.getByRole("button", { name: "Close", exact: true }));
  await click(page.getByRole("link", { name: "Tags & Topics", exact: true }));
  caption("Keep a clear, consistent set of topics for your team.");
  await pause(1300);
  await snapshot("04-tags-and-topics");
  await pause(1800);
  await click(page.getByRole("link", { name: "Members", exact: true }));
  caption("Give each member the right level of access.");
  await pause(1300);
  await snapshot("05-members");
  await pause(2000);
  await click(page.getByRole("link", { name: "Dashboard", exact: true }));
  await pause(500);
  const backdrop = (await readFile(path.join(output, "01-dashboard.png"))).toString("base64");
  await installChromeMocks(page, { connected: true });
  await page.goto(`${extensionOrigin}/popup.html`, { waitUntil: "networkidle" });
  await page.locator("#entry-form:not([hidden])").waitFor();
  await page.evaluate((background) => {
    const panel = document.createElement("div");
    panel.id = "extension-panel";
    for (const element of [...document.body.children])
      if (element.tagName === "HEADER" || element.tagName === "MAIN") panel.append(element);
    document.body.append(panel);
    document.documentElement.style.cssText = "width:100%;height:100%";
    document.body.style.cssText = `width:100%;height:100vh;display:grid;place-items:center;background:linear-gradient(#eef4ff99,#eef4ff99),url(data:image/png;base64,${background}) center/cover;`;
    panel.style.cssText =
      "width:420px;border-radius:24px;overflow:hidden;background:#ffffff;box-shadow:0 35px 100px #1b254b55;border:1px solid #e2e8f0;transform:scale(1.2)";
  }, backdrop);
  caption("Capture links with the Curio Chrome extension.");
  await page.locator(".tag-option input").first().check();
  await pause(1500);
  await snapshot("06-chrome-extension");
  await pause(1500);
  await click(page.getByRole("button", { name: "Submit", exact: true }));
  await page.getByText("Saved to Curio.", { exact: true }).waitFor();
  await pause(2400);
  caption("Capture once. Discover, share and revisit together.");
  await page.goto(`${origin}/demo/studio`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal { display:none!important }" });
  await pause(3500);
  const duration = (Date.now() - start) / 1000;
  const raw = await page.video().path();
  await context.close();
  context = null;
  const stamp = (value) => {
    const ms = Math.round(value * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  const srt = captions
    .map(
      (item, i) =>
        `${i + 1}\n${stamp(item.start)} --> ${stamp((captions[i + 1]?.start ?? duration) - 0.1)}\n${item.text}\n`,
    )
    .join("\n");
  await writeFile(path.join(output, "curio-tour.en.srt"), srt);
  const clean = path.join(output, "curio-tour-clean.mp4");
  const baseArgs = [
    "-y",
    "-i",
    raw,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "19",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-movflags",
    "+faststart",
  ];
  for (const [name, filter] of [
    [clean, null],
    [
      path.join(output, "curio-tour.en.mp4"),
      "subtitles=curio-tour.en.srt:force_style='FontName=Arial,FontSize=10,PrimaryColour=&HFFFFFF,OutlineColour=&H802B211B,BorderStyle=3,Outline=3,Shadow=0,MarginV=10'",
    ],
  ]) {
    const args = [...baseArgs];
    if (filter) args.push("-vf", filter);
    args.push(name);
    const result = spawnSync("ffmpeg", args, {
      cwd: output,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  await writeFile(
    path.join(output, "capture-report.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        durationSeconds: duration,
        viewport: { width: 1920, height: 1080 },
        screenshots: 6,
        syntheticData: true,
        extensionBackend: "synthetic capture adapter",
        source: "actual Curio components and extension package",
        captions,
      },
      null,
      2,
    ),
  );
  console.log(
    `Recorded ${duration.toFixed(1)} seconds, 6 clean screenshots, MP4 with/without English captions.`,
  );
} finally {
  await context?.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
