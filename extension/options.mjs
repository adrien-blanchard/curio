import { CurioApi, CurioApiError, profileLabel } from "./lib/api.mjs";
import {
  instancePermissionPattern,
  missingRequiredScopes,
  normalizeInstanceUrl,
  normalizePersonalToken,
} from "./lib/config.mjs";
import { retainOnlyOriginPermission } from "./lib/permissions.mjs";
import { createSettingsStore } from "./lib/storage.mjs";

const elements = Object.freeze({
  form: document.querySelector("#settings-form"),
  instanceUrl: document.querySelector("#instance-url"),
  token: document.querySelector("#personal-token"),
  tokenState: document.querySelector("#token-state"),
  status: document.querySelector("#settings-status"),
  save: document.querySelector("#save-settings"),
  forget: document.querySelector("#forget-token"),
});

const store = createSettingsStore();
let savedSettings = Object.freeze({ instanceUrl: "", token: "" });
const grantedOriginsAtLoad = new Set();

function setStatus(message, type = "info") {
  elements.status.textContent = message;
  elements.status.className = `status status-${type}`;
  elements.status.hidden = false;
}

function describeStoredToken() {
  elements.tokenState.textContent = savedSettings.token
    ? "A connection key is stored. Leave this field blank to keep it."
    : "No connection key is stored.";
  elements.forget.disabled = !savedSettings.token;
}

async function initialize() {
  await store.prepare();
  const [settings, permissions] = await Promise.all([store.load(), chrome.permissions.getAll()]);
  savedSettings = settings;
  for (const origin of permissions.origins ?? []) grantedOriginsAtLoad.add(origin);
  elements.instanceUrl.value = savedSettings.instanceUrl;
  describeStoredToken();
  elements.form.addEventListener("submit", saveSettings);
  elements.forget.addEventListener("click", forgetToken);
}

async function saveSettings(event) {
  event.preventDefault();
  elements.save.disabled = true;
  elements.save.textContent = "Verifying…";

  let instanceUrl;
  let token;
  let permission;
  let granted = false;
  let wasGrantedAtLoad = false;
  let settingsCommitted = false;

  try {
    instanceUrl = normalizeInstanceUrl(elements.instanceUrl.value);
    token = normalizePersonalToken(elements.token.value || savedSettings.token);
    permission = instancePermissionPattern(instanceUrl);
    wasGrantedAtLoad = grantedOriginsAtLoad.has(permission);

    // This must be the first asynchronous Chrome call in the submit handler so
    // the optional-origin prompt remains tied to the user's click.
    granted = await chrome.permissions.request({ origins: [permission] });
    if (!granted) throw new Error("Chrome access to this Curio origin was not granted.");
    grantedOriginsAtLoad.add(permission);

    const profile = await new CurioApi({ instanceUrl, token }).getProfile();
    const missingScopes = missingRequiredScopes(profile);
    if (missingScopes.length) {
      throw new Error("Create a new browser connection key in Curio and try again.");
    }

    await store.save({ instanceUrl, token });
    settingsCommitted = true;
    await retainOnlyOriginPermission(chrome.permissions, permission);
    savedSettings = Object.freeze({ instanceUrl, token });
    elements.instanceUrl.value = instanceUrl;
    elements.token.value = "";
    describeStoredToken();

    grantedOriginsAtLoad.clear();
    grantedOriginsAtLoad.add(permission);

    setStatus(`Connected as ${profileLabel(profile)}. Settings saved.`, "success");
  } catch (error) {
    if (!settingsCommitted && granted && !wasGrantedAtLoad && permission) {
      await chrome.permissions.remove({ origins: [permission] }).catch(() => false);
      grantedOriginsAtLoad.delete(permission);
    }
    const message =
      error instanceof CurioApiError || error instanceof TypeError || error instanceof Error
        ? error.message
        : "Could not verify these settings.";
    setStatus(message, "error");
  } finally {
    elements.save.disabled = false;
    elements.save.textContent = "Verify and save";
  }
}

async function forgetToken() {
  await store.clearToken();
  savedSettings = Object.freeze({ ...savedSettings, token: "" });
  elements.token.value = "";
  describeStoredToken();
  setStatus(
    "The key was removed from this browser. Revoke it in Curio if it may be compromised.",
    "success",
  );
}

initialize().catch(() => setStatus("Could not load extension settings.", "error"));
