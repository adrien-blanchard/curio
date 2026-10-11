// Scoped to Next ESLint's getRootDirs; this is not a general fast-glob replacement.
/* eslint-disable @typescript-eslint/no-require-imports -- Next ESLint loads this adapter via require. */
const { isAbsolute, win32 } = require("node:path");
const { globSync: glob } = require("tinyglobby");

exports.globSync = function globSync(pattern, options = {}) {
  if (typeof pattern !== "string" || options.onlyDirectories !== true) {
    throw new TypeError("Unexpected Next ESLint glob API; review the dependency override.");
  }
  return glob(pattern, {
    ...options,
    // fast-glob preserves absolute input paths; tinyglobby defaults to relative output.
    absolute: isAbsolute(pattern) || win32.isAbsolute(pattern),
  });
};
