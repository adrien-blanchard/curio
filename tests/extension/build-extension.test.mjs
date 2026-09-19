import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIXED_ZIP_DATE,
  LAST_PUBLISHED_STORE_VERSION,
  PACKAGE_FILES,
  REPOSITORY_ROOT,
  collectPackageEntries,
  compareChromeVersions,
  crc32,
  createDeterministicZip,
  validateStoreUpgradeVersion,
} from "../../scripts/build-extension.mjs";

describe("deterministic extension archive", () => {
  it("requires a Store version newer than the already published extension", () => {
    expect(compareChromeVersions("1.2.0", LAST_PUBLISHED_STORE_VERSION)).toBe(1);
    expect(compareChromeVersions("1.1", LAST_PUBLISHED_STORE_VERSION)).toBe(0);
    expect(validateStoreUpgradeVersion("1.2.0")).toBe("1.2.0");
    expect(() => validateStoreUpgradeVersion("1.1.0")).toThrow(/must be newer/u);
    expect(() => validateStoreUpgradeVersion("1.0.9")).toThrow(/must be newer/u);
  });

  it("packages the extension version independently from the application release", async () => {
    const [manifest, releaseWorkflow] = await Promise.all([
      fs
        .readFile(path.join(REPOSITORY_ROOT, "extension", "manifest.json"), "utf8")
        .then(JSON.parse),
      fs.readFile(
        path.join(REPOSITORY_ROOT, ".github", "workflows", "release-artifacts.yml"),
        "utf8",
      ),
    ]);

    expect(compareChromeVersions(manifest.version, LAST_PUBLISHED_STORE_VERSION)).toBe(1);
    expect(releaseWorkflow).not.toContain('test "$package_version" = "$extension_version"');
    expect(releaseWorkflow).toContain('test "$GITHUB_REF_NAME" = "v$package_version"');
    expect(releaseWorkflow).toContain(
      'archive="artifacts/curio-extension-${EXTENSION_VERSION}.zip"',
    );
  });

  it("uses a stable inventory and creates byte-identical ZIP archives", async () => {
    const entries = await collectPackageEntries();
    expect(entries.map((entry) => entry.path)).toEqual([...PACKAGE_FILES].sort());

    const first = createDeterministicZip(entries);
    const second = createDeterministicZip([...entries].reverse());
    expect(second.equals(first)).toBe(true);
    expect(createHash("sha256").update(second).digest("hex")).toBe(
      createHash("sha256").update(first).digest("hex"),
    );
  });

  it("uses the ZIP epoch timestamp and store mode", () => {
    const archive = createDeterministicZip([{ path: "hello.txt", data: Buffer.from("hello\n") }]);
    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    expect(archive.readUInt16LE(8)).toBe(0);
    expect(archive.readUInt16LE(10)).toBe(FIXED_ZIP_DATE.dosTime);
    expect(archive.readUInt16LE(12)).toBe(FIXED_ZIP_DATE.dosDate);
  });

  it("computes standard CRC-32 values", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("rejects unsafe or duplicate paths", () => {
    expect(() => createDeterministicZip([{ path: "../escape", data: Buffer.alloc(0) }])).toThrow(
      /Unsafe/u,
    );
    expect(() =>
      createDeterministicZip([
        { path: "same.txt", data: Buffer.from("one") },
        { path: "same.txt", data: Buffer.from("two") },
      ]),
    ).toThrow(/Duplicate/u);
  });
});
