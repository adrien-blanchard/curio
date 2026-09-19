import { promises as fs } from "node:fs";

import { atomicWrite } from "./io.mjs";

export async function loadMigrationCheckpoint(filePath, manifestDigest) {
  try {
    const checkpoint = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (
      checkpoint.version !== 1 ||
      checkpoint.manifestDigest !== manifestDigest ||
      !Array.isArray(checkpoint.completed) ||
      checkpoint.completed.some(
        (value) => typeof value !== "string" || !/^[0-9a-f]{24}$/u.test(value),
      )
    ) {
      throw new Error("CHECKPOINT_MISMATCH");
    }
    return {
      version: 1,
      manifestDigest,
      completed: new Set(checkpoint.completed),
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, manifestDigest, completed: new Set() };
    }
    throw error;
  }
}

export async function saveMigrationCheckpoint(filePath, checkpoint) {
  await atomicWrite(
    filePath,
    `${JSON.stringify(
      {
        version: checkpoint.version,
        manifestDigest: checkpoint.manifestDigest,
        completed: [...checkpoint.completed].sort(),
      },
      null,
      2,
    )}\n`,
  );
}
