import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadMigrationCheckpoint,
  saveMigrationCheckpoint,
} from "../../src/lib/migration/checkpoint.mjs";
import { opaqueFingerprint } from "../../src/lib/migration/io.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("migration checkpoint", () => {
  it("persists opaque completed fingerprints and resumes them", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "curio-checkpoint-"));
    temporaryDirectories.push(directory);
    const checkpointPath = path.join(directory, "checkpoint.json");
    const completed = opaqueFingerprint("https://private.example.invalid/resource");

    await saveMigrationCheckpoint(checkpointPath, {
      version: 1,
      manifestDigest: "manifest-a",
      completed: new Set([completed]),
    });
    const loaded = await loadMigrationCheckpoint(checkpointPath, "manifest-a");
    const serialized = await fs.readFile(checkpointPath, "utf8");

    expect(loaded.completed).toEqual(new Set([completed]));
    expect(serialized).not.toContain("private.example.invalid");
  });

  it("rejects reuse with a different archive digest", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "curio-checkpoint-"));
    temporaryDirectories.push(directory);
    const checkpointPath = path.join(directory, "checkpoint.json");
    await saveMigrationCheckpoint(checkpointPath, {
      version: 1,
      manifestDigest: "manifest-a",
      completed: new Set(),
    });

    await expect(loadMigrationCheckpoint(checkpointPath, "manifest-b")).rejects.toThrow(
      "CHECKPOINT_MISMATCH",
    );
  });
});
