import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDirectory = path.join(repositoryRoot, "extension");
const outputDirectory = path.join(repositoryRoot, "docs", "store-assets");
const chromeExecutable = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
]);

export function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent(new URL(request.url ?? "/", "http://local").pathname);
      const relativePath = requestPath === "/" ? "popup.html" : requestPath.slice(1);
      const filePath = path.resolve(extensionDirectory, relativePath);
      if (!filePath.startsWith(`${extensionDirectory}${path.sep}`)) {
        response.writeHead(404).end();
        return;
      }
      const body = await fs.readFile(filePath);
      response.writeHead(200, {
        "Content-Type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not start the extension asset server."));
        return;
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

export async function installChromeMocks(page, { connected }) {
  await page.addInitScript(
    ({ hasConnection }) => {
      const values = hasConnection
        ? {
            curioInstanceUrl: "https://curio.example.test",
            curioPersonalToken: "curio_synthetic_store_capture_key",
          }
        : {};
      globalThis.chrome = {
        permissions: {
          contains: async () => true,
          getAll: async () => ({ origins: hasConnection ? ["https://curio.example.test/*"] : [] }),
          remove: async () => true,
          request: async () => true,
        },
        runtime: { openOptionsPage: async () => undefined },
        storage: {
          local: {
            get: async (keys) =>
              Object.fromEntries(
                keys.filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]]),
              ),
            remove: async (key) => delete values[key],
            set: async (next) => Object.assign(values, next),
            setAccessLevel: async () => undefined,
          },
        },
        tabs: {
          query: async () => [
            { url: "https://example.com/articles/production-ready-ai-workflows" },
          ],
        },
      };
      globalThis.fetch = async (input) => {
        const pathname = new URL(String(input)).pathname;
        if (pathname === "/api/v1/me") {
          return new Response(
            JSON.stringify({
              data: {
                user: {
                  display_name: "Demo contributor",
                  scopes: ["entries:write", "tags:read", "profile:read"],
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (pathname === "/api/v1/tags") {
          return new Response(
            JSON.stringify({
              data: {
                tags: [
                  { id: "00000000-0000-4000-8000-000000000001", name: "Agentic" },
                  { id: "00000000-0000-4000-8000-000000000002", name: "Image Editing" },
                  { id: "00000000-0000-4000-8000-000000000003", name: "Open Source" },
                  { id: "00000000-0000-4000-8000-000000000004", name: "Real-Time" },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ data: {}, error: null }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      };
    },
    { hasConnection: connected },
  );
}

async function capturePopup(browser, origin) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  await installChromeMocks(page, { connected: true });
  await page.goto(`${origin}/popup.html`, { waitUntil: "networkidle" });
  await page.locator("#entry-form:not([hidden])").waitFor();
  await page.locator('.tag-option input[value="00000000-0000-4000-8000-000000000001"]').check();
  await page.evaluate(() => {
    const frame = document.createElement("section");
    frame.className = "store-popup-frame";
    const header = document.querySelector("body > header");
    const main = document.querySelector("body > main");
    if (header) frame.appendChild(header);
    if (main) frame.appendChild(main);

    const copy = document.createElement("section");
    copy.className = "store-copy";
    const eyebrow = document.createElement("p");
    eyebrow.textContent = "CURIO FOR CHROME";
    const title = document.createElement("h1");
    title.textContent = "Save the useful things you find.";
    const description = document.createElement("p");
    description.textContent =
      "Send the current page to Curio, add the right tags, and keep your team's knowledge base moving.";
    copy.append(eyebrow, title, description);
    document.body.prepend(copy, frame);
    document.body.classList.add("store-capture");
  });
  await page.addStyleTag({
    content: `
      html { width: 100%; height: 100%; background: #eef5ff; }
      body.store-capture {
        width: 1280px; min-height: 800px; overflow: hidden; padding: 64px 100px; display: grid;
        grid-template-columns: minmax(0, 1fr) 390px; align-items: center; gap: 92px;
        background: radial-gradient(circle at 12% 8%, #fff 0 8%, transparent 27%),
          linear-gradient(135deg, #eef9ff 0%, #e6edff 100%);
      }
      .store-copy { max-width: 560px; }
      .store-copy > p:first-child { margin: 0 0 18px; color: #0276ca; font-size: 15px;
        font-weight: 800; letter-spacing: .13em; }
      .store-copy h1 { margin: 0; color: #1b254b; font-size: 58px; line-height: 1.03;
        letter-spacing: -.045em; }
      .store-copy > p:last-child { margin: 24px 0 0; color: #536486; font-size: 21px;
        font-weight: 520; line-height: 1.55; }
      .store-popup-frame { overflow: hidden; width: 390px; max-height: 690px; border: 1px solid #dce3ef;
        border-radius: 24px; background: #f5f7fb; box-shadow: 0 28px 70px rgba(27,37,75,.2); }
      .store-popup-frame main { max-height: 610px; overflow: hidden; }
    `,
  });
  await page.screenshot({
    path: path.join(outputDirectory, "curio-store-screenshot-popup-1280x800.png"),
  });
  await page.close();
}

async function captureSettings(browser, origin) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  await installChromeMocks(page, { connected: false });
  await page.goto(`${origin}/options.html`, { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(outputDirectory, "curio-store-screenshot-settings-1280x800.png"),
  });
  await page.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await fs.mkdir(outputDirectory, { recursive: true });
  const { server, origin } = await startStaticServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: chromeExecutable });
    await capturePopup(browser, origin);
    await captureSettings(browser, origin);
  } finally {
    await browser?.close();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  process.stdout.write("Captured sanitized Chrome Web Store screenshots.\n");
}
