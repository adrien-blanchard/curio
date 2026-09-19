import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
export const EXTENSION_DIRECTORY = path.join(REPOSITORY_ROOT, "extension");
export const FIXED_ZIP_DATE = Object.freeze({ dosDate: 33, dosTime: 0 });
export const LAST_PUBLISHED_STORE_VERSION = "1.1.0";

export const PACKAGE_FILES = Object.freeze([
  "icons/icon-128.png",
  "icons/icon-16.png",
  "icons/icon-48.png",
  "lib/api.mjs",
  "lib/config.mjs",
  "lib/permissions.mjs",
  "lib/storage.mjs",
  "manifest.json",
  "options.css",
  "options.html",
  "options.mjs",
  "popup.css",
  "popup.html",
  "popup.mjs",
]);

const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs"]);
const OPTIONAL_ORIGINS = ["http://127.0.0.1/*", "http://localhost/*", "https://*/*"];
const REQUIRED_PERMISSIONS = ["activeTab", "storage"];

function sorted(values) {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseChromeVersion(version) {
  const parts = String(version ?? "").split(".");
  if (
    parts.length < 1 ||
    parts.length > 4 ||
    parts.some((part) => !/^(0|[1-9][0-9]{0,4})$/u.test(part) || Number(part) > 65_535)
  ) {
    throw new Error("Manifest version must contain one to four integers from 0 to 65535.");
  }
  return parts.map(Number);
}

export function compareChromeVersions(leftVersion, rightVersion) {
  const left = parseChromeVersion(leftVersion);
  const right = parseChromeVersion(rightVersion);
  for (let index = 0; index < 4; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

export function validateStoreUpgradeVersion(
  version,
  publishedVersion = LAST_PUBLISHED_STORE_VERSION,
) {
  if (compareChromeVersions(version, publishedVersion) <= 0) {
    throw new Error(
      `Extension version ${version} must be newer than the published Store version ${publishedVersion}.`,
    );
  }
  return version;
}

function decodeManifestPublicKey(publicKey) {
  if (typeof publicKey !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(publicKey)) {
    throw new Error("Manifest public key must be canonical base64.");
  }
  const bytes = Buffer.from(publicKey, "base64");
  if (bytes.length < 64 || bytes[0] !== 0x30 || bytes.toString("base64") !== publicKey) {
    throw new Error("Manifest public key must be canonical base64-encoded DER.");
  }
  return bytes;
}

export function deriveChromeExtensionId(publicKey) {
  const alphabet = "abcdefghijklmnop";
  const digest = createHash("sha256").update(decodeManifestPublicKey(publicKey)).digest();
  let extensionId = "";
  for (const byte of digest.subarray(0, 16)) {
    extensionId += alphabet[byte >>> 4] + alphabet[byte & 0x0f];
  }
  return extensionId;
}

export function validateManifest(manifest) {
  if (manifest?.manifest_version !== 3) throw new Error("The extension must use Manifest V3.");
  if (typeof manifest.name !== "string" || !manifest.name.trim())
    throw new Error("Manifest name is required.");

  parseChromeVersion(manifest.version);
  deriveChromeExtensionId(manifest.key);

  if (Object.hasOwn(manifest, "host_permissions")) {
    throw new Error("Required host permissions are forbidden; use optional_host_permissions only.");
  }
  for (const forbiddenKey of ["background", "content_scripts", "externally_connectable"]) {
    if (Object.hasOwn(manifest, forbiddenKey))
      throw new Error(`Manifest key ${forbiddenKey} is forbidden.`);
  }

  if (!arraysEqual(sorted(manifest.permissions ?? []), REQUIRED_PERMISSIONS)) {
    throw new Error("Manifest permissions are not the approved minimal set.");
  }
  if (!arraysEqual(sorted(manifest.optional_host_permissions ?? []), OPTIONAL_ORIGINS)) {
    throw new Error("Manifest optional host permissions are not the approved set.");
  }
  if (manifest.action?.default_popup !== "popup.html")
    throw new Error("Manifest popup reference is invalid.");
  if (manifest.options_ui?.page !== "options.html")
    throw new Error("Manifest options reference is invalid.");

  return manifest.version;
}

async function walkFiles(directory, relativeDirectory = "") {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (relativeDirectory === "" && (entry.name === "dist" || entry.name === ".gitignore"))
      continue;
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(absolutePath, relativePath)));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`Unsupported extension source entry: ${relativePath}`);
  }
  return sorted(files);
}

function normalizeFileBytes(filePath, bytes) {
  if (!TEXT_EXTENSIONS.has(path.extname(filePath))) return bytes;
  return Buffer.from(bytes.toString("utf8").replace(/\r\n?/gu, "\n"), "utf8");
}

export async function collectPackageEntries(extensionDirectory = EXTENSION_DIRECTORY) {
  const actualFiles = await walkFiles(extensionDirectory);
  if (!arraysEqual(actualFiles, sorted(PACKAGE_FILES))) {
    const missing = PACKAGE_FILES.filter((file) => !actualFiles.includes(file));
    const unexpected = actualFiles.filter((file) => !PACKAGE_FILES.includes(file));
    throw new Error(
      `Extension file inventory mismatch. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}.`,
    );
  }

  const packageEntries = [];
  for (const relativePath of sorted(PACKAGE_FILES)) {
    const bytes = await fs.readFile(path.join(extensionDirectory, ...relativePath.split("/")));
    packageEntries.push({
      path: relativePath,
      data: normalizeFileBytes(relativePath, bytes),
    });
  }

  const manifestEntry = packageEntries.find((entry) => entry.path === "manifest.json");
  const manifestVersion = validateManifest(JSON.parse(manifestEntry.data.toString("utf8")));
  validateStoreUpgradeVersion(manifestVersion);
  return packageEntries;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function validateArchivePath(relativePath) {
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe ZIP entry path: ${relativePath}`);
  }
}

export function createDeterministicZip(inputEntries) {
  const entries = [...inputEntries]
    .map((entry) => ({ path: entry.path, data: Buffer.from(entry.data) }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  if (!entries.length || entries.length > 65_535) throw new Error("ZIP entry count is invalid.");

  const seen = new Set();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    validateArchivePath(entry.path);
    if (seen.has(entry.path)) throw new Error(`Duplicate ZIP entry: ${entry.path}`);
    seen.add(entry.path);

    const name = Buffer.from(entry.path, "utf8");
    if (name.length > 65_535 || entry.data.length > 0xffffffff)
      throw new Error(`ZIP entry is too large: ${entry.path}`);
    const checksum = crc32(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(FIXED_ZIP_DATE.dosTime, 10);
    localHeader.writeUInt16LE(FIXED_ZIP_DATE.dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(entry.data.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(FIXED_ZIP_DATE.dosTime, 12);
    centralHeader.writeUInt16LE(FIXED_ZIP_DATE.dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(entry.data.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function parseArguments(argumentsList) {
  let outputPath;
  let checkOnly = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--check") checkOnly = true;
    else if (argument === "--output") {
      outputPath = argumentsList[index + 1];
      index += 1;
      if (!outputPath) throw new Error("--output requires a path.");
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return { checkOnly, outputPath };
}

export async function buildExtension({ outputPath, checkOnly = false } = {}) {
  const entries = await collectPackageEntries();
  const manifest = JSON.parse(
    entries.find((entry) => entry.path === "manifest.json").data.toString("utf8"),
  );
  const archive = createDeterministicZip(entries);
  const checksum = createHash("sha256").update(archive).digest("hex");
  const defaultOutput = path.join(
    EXTENSION_DIRECTORY,
    "dist",
    `curio-extension-${manifest.version}.zip`,
  );
  const finalOutput = path.resolve(outputPath ?? defaultOutput);

  const relativeToSource = path.relative(EXTENSION_DIRECTORY, finalOutput);
  if (
    !relativeToSource.startsWith("..") &&
    !path.isAbsolute(relativeToSource) &&
    !relativeToSource.startsWith(`dist${path.sep}`)
  ) {
    throw new Error("ZIP output inside extension/ is allowed only under extension/dist/.");
  }

  if (!checkOnly) {
    await fs.mkdir(path.dirname(finalOutput), { recursive: true });
    await fs.writeFile(finalOutput, archive);
  }

  return Object.freeze({
    archive,
    checksum,
    entryCount: entries.length,
    outputPath: checkOnly ? null : finalOutput,
    version: manifest.version,
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await buildExtension(options);
  const destination = result.outputPath ?? "check only; no file written";
  process.stdout.write(
    `Curio extension ${result.version}: ${result.entryCount} files, ${result.archive.length} bytes\n` +
      `SHA-256: ${result.checksum}\n` +
      `Output: ${destination}\n`,
  );
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`Extension build failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
