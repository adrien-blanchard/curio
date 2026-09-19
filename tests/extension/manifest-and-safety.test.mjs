import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveChromeExtensionId,
  EXTENSION_DIRECTORY,
  PACKAGE_FILES,
  validateManifest,
} from "../../scripts/build-extension.mjs";

async function read(relativePath) {
  return fs.readFile(path.join(EXTENSION_DIRECTORY, ...relativePath.split("/")), "utf8");
}

describe("Manifest V3 and extension safety", () => {
  it("preserves the published Store identity with a public manifest key", async () => {
    const manifest = JSON.parse(await read("manifest.json"));
    expect(deriveChromeExtensionId(manifest.key)).toBe("bldceafomhokgmndglcllplmnclklcdn");
  });

  it("runs the legacy-session purge before either extension page loads settings", async () => {
    const [popup, options] = await Promise.all([read("popup.mjs"), read("options.mjs")]);
    for (const source of [popup, options]) {
      expect(source).toMatch(/await store\.prepare\(\);/u);
      expect(source.indexOf("await store.prepare();")).toBeLessThan(source.indexOf("store.load()"));
    }
  });

  it("removes obsolete origin grants after committing the selected instance", async () => {
    const options = await read("options.mjs");
    expect(options.indexOf("await store.save({ instanceUrl, token });")).toBeGreaterThan(-1);
    expect(
      options.indexOf("await retainOnlyOriginPermission(chrome.permissions, permission);"),
    ).toBeGreaterThan(options.indexOf("await store.save({ instanceUrl, token });"));
  });

  it("uses only minimal non-host permissions and optional host access", async () => {
    const manifest = JSON.parse(await read("manifest.json"));
    expect(() => validateManifest(manifest)).not.toThrow();
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("background");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest.permissions).toEqual(["activeTab", "storage"]);
  });

  it("contains no content bridge, cookie bridge, refresh token, or required host permission", async () => {
    const sources = (
      await Promise.all(
        PACKAGE_FILES.filter((file) => /\.(?:html|mjs|json)$/u.test(file)).map(read),
      )
    ).join("\n");
    expect(sources).not.toMatch(/refresh[_-]?token/iu);
    expect(sources).not.toMatch(/document\.cookie|chrome\.cookies|credentials\s*:\s*["']include/iu);
    expect(sources).not.toMatch(/\/api\/auth\/extension-token/iu);
    expect(sources).not.toMatch(/externally_connectable/iu);
  });

  it("does not use HTML injection sinks for dynamic DOM", async () => {
    const scripts = (
      await Promise.all(PACKAGE_FILES.filter((file) => file.endsWith(".mjs")).map(read))
    ).join("\n");
    expect(scripts).not.toMatch(
      /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\b/u,
    );
    expect(scripts).toMatch(/createElement/u);
    expect(scripts).toMatch(/textContent/u);
  });

  it("contains no organization domain, person, store ID, or legacy product endpoint", async () => {
    const sources = (
      await Promise.all(PACKAGE_FILES.filter((file) => !file.endsWith(".png")).map(read))
    ).join("\n");
    const legacyMarkers = [["frame", "store"].join(""), ["tech", "monitoring"].join("-")];
    for (const marker of legacyMarkers) {
      expect(sources.toLowerCase()).not.toContain(marker);
    }
    expect(sources).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}|[a-p]{32}/iu);
  });

  it("documents local token storage risk and server-side revocation", async () => {
    const options = await read("options.html");
    expect(options).toMatch(/chrome\.storage\.local/u);
    expect(options).toMatch(/does not provide\s+application-level encryption/u);
    expect(options).toMatch(/server-side revocation remains\s+authoritative/u);
  });
});
