// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { getRootDirs } = require("@next/eslint-plugin-next/dist/utils/get-root-dirs.js");
const pluginRequire = createRequire(require.resolve("@next/eslint-plugin-next"));
const root = mkdtempSync(join(tmpdir(), "curio-eslint-glob-"));
const normalized = root.replaceAll("\\", "/");
for (const directory of ["app-one", "app-two", "other"]) {
  mkdirSync(join(root, directory));
}
writeFileSync(join(root, "app-file.txt"), "not a directory");
const discover = (rootDir) => getRootDirs({ cwd: normalized, settings: { next: { rootDir } } });
const clean = (paths) => paths.map((path) => path.replace(/\/$/, "")).sort();

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("Next ESLint glob compatibility", () => {
  it("uses the reviewed replacement rather than vulnerable fast-glob/braces", () => {
    expect(pluginRequire("fast-glob/package.json").name).toBe("@curio/eslint-glob");
  });

  it("preserves the default project root", () => {
    expect(discover(undefined)).toEqual([normalized]);
  });

  it("preserves relative paths", () => {
    expect(clean(discover("tools/eslint-*"))).toEqual(["tools/eslint-glob"]);
  });

  it("fails explicitly if the upstream plugin changes its API usage", () => {
    const { globSync } = pluginRequire("fast-glob");
    expect(() => globSync("**/*")).toThrow("Unexpected Next ESLint glob API");
    expect(() => globSync(["**/*"], { onlyDirectories: true })).toThrow(
      "Unexpected Next ESLint glob API",
    );
  });

  it("finds directories, excluding matching files", () => {
    expect(clean(discover(`${normalized}/app-*`))).toEqual([
      `${normalized}/app-one`,
      `${normalized}/app-two`,
    ]);
  });

  it("supports brace patterns and multiple roots", () => {
    expect(clean(discover(`${normalized}/{app-one,app-two}`))).toEqual([
      `${normalized}/app-one`,
      `${normalized}/app-two`,
    ]);
    expect(clean(discover([`${normalized}/app-one`, `${normalized}/other`]))).toEqual([
      `${normalized}/app-one`,
      `${normalized}/other`,
    ]);
  });

  it("normalizes Windows separators and handles unmatched patterns", () => {
    expect(clean(discover(`${normalized}/app-one`.replaceAll("/", "\\")))).toEqual([
      `${normalized}/app-one`,
    ]);
    expect(discover(`${normalized}/missing-*`)).toEqual([]);
  });
});
