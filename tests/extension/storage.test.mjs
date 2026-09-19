import { describe, expect, it } from "vitest";
import { STORAGE_KEYS, createSettingsStore } from "../../extension/lib/storage.mjs";

function fakeStorage(initial = {}) {
  const values = { ...initial };
  const accessLevels = [];
  return {
    values,
    accessLevels,
    async get(keys) {
      return Object.fromEntries(
        keys.filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]]),
      );
    },
    async set(nextValues) {
      Object.assign(values, nextValues);
    },
    async remove(key) {
      delete values[key];
    },
    async setAccessLevel(options) {
      accessLevels.push(options);
    },
  };
}

describe("extension settings storage", () => {
  it("stores only the instance URL and personal token", async () => {
    const area = fakeStorage();
    const store = createSettingsStore(area);
    await store.save({ instanceUrl: "https://curio.example.test", token: "personal-token" });
    expect(area.values).toEqual({
      [STORAGE_KEYS.instanceUrl]: "https://curio.example.test",
      [STORAGE_KEYS.personalToken]: "personal-token",
    });
    await expect(store.load()).resolves.toEqual({
      instanceUrl: "https://curio.example.test",
      token: "personal-token",
    });
  });

  it("forgets the local token without deleting the instance URL", async () => {
    const area = fakeStorage({
      [STORAGE_KEYS.instanceUrl]: "https://curio.example.test",
      [STORAGE_KEYS.personalToken]: "personal-token",
    });
    const store = createSettingsStore(area);
    await store.clearToken();
    await expect(store.load()).resolves.toEqual({
      instanceUrl: "https://curio.example.test",
      token: "",
    });
  });

  it("limits storage exposure and idempotently purges the legacy Supabase session", async () => {
    const area = fakeStorage({
      [STORAGE_KEYS.instanceUrl]: "https://curio.example.test",
      [STORAGE_KEYS.personalToken]: "current-personal-token",
      [STORAGE_KEYS.legacySession]: {
        access_token: "legacy-access-token",
        refresh_token: "legacy-refresh-token",
        user: { id: "legacy-user" },
      },
    });
    const store = createSettingsStore(area);
    await store.prepare();
    await store.prepare();
    expect(area.accessLevels).toEqual([
      { accessLevel: "TRUSTED_CONTEXTS" },
      { accessLevel: "TRUSTED_CONTEXTS" },
    ]);
    expect(area.values).toEqual({
      [STORAGE_KEYS.instanceUrl]: "https://curio.example.test",
      [STORAGE_KEYS.personalToken]: "current-personal-token",
    });
  });
});
