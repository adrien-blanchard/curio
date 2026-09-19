const INSTANCE_URL_KEY = "curioInstanceUrl";
const PERSONAL_TOKEN_KEY = "curioPersonalToken";
const LEGACY_SESSION_KEY = "session";

function requireStorageArea(storageArea) {
  if (!storageArea?.get || !storageArea?.set || !storageArea?.remove) {
    throw new TypeError("A Chrome storage area is required.");
  }
  return storageArea;
}

export function createSettingsStore(storageArea = globalThis.chrome?.storage?.local) {
  const area = requireStorageArea(storageArea);

  return Object.freeze({
    async prepare() {
      // Versions through 1.1 stored a Supabase session, including its refresh
      // token, under this key. Removal is intentionally repeated at startup so
      // interrupted upgrades and restored browser profiles are also cleaned.
      const operations = [area.remove(LEGACY_SESSION_KEY)];
      if (typeof area.setAccessLevel === "function") {
        operations.push(area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }));
      }
      await Promise.all(operations);
    },

    async load() {
      const values = await area.get([INSTANCE_URL_KEY, PERSONAL_TOKEN_KEY]);
      return Object.freeze({
        instanceUrl: typeof values[INSTANCE_URL_KEY] === "string" ? values[INSTANCE_URL_KEY] : "",
        token: typeof values[PERSONAL_TOKEN_KEY] === "string" ? values[PERSONAL_TOKEN_KEY] : "",
      });
    },

    async save({ instanceUrl, token }) {
      await area.set({
        [INSTANCE_URL_KEY]: instanceUrl,
        [PERSONAL_TOKEN_KEY]: token,
      });
    },

    async clearToken() {
      await area.remove(PERSONAL_TOKEN_KEY);
    },
  });
}

export const STORAGE_KEYS = Object.freeze({
  instanceUrl: INSTANCE_URL_KEY,
  legacySession: LEGACY_SESSION_KEY,
  personalToken: PERSONAL_TOKEN_KEY,
});
