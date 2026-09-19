import { CurioApi, CurioApiError, profileLabel, tagsFromResponse } from "./lib/api.mjs";
import {
  MAX_SELECTED_TAGS,
  instancePermissionPattern,
  missingRequiredScopes,
  normalizeArticleUrl,
} from "./lib/config.mjs";
import { createSettingsStore } from "./lib/storage.mjs";

const elements = Object.freeze({
  globalStatus: document.querySelector("#global-status"),
  setupPanel: document.querySelector("#setup-panel"),
  form: document.querySelector("#entry-form"),
  formStatus: document.querySelector("#form-status"),
  pageUrl: document.querySelector("#page-url"),
  profileLabel: document.querySelector("#profile-label"),
  tagList: document.querySelector("#tag-list"),
  tagCount: document.querySelector("#tag-count"),
  submit: document.querySelector("#submit-entry"),
  submitLabel: document.querySelector("#submit-label"),
  configure: document.querySelector("#configure"),
  openOptions: document.querySelector("#open-options"),
});

let api;
const store = createSettingsStore();

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setStatus(node, message, type = "info") {
  node.textContent = message;
  node.className = `status status-${type}`;
  node.hidden = false;
}

function hideStatus(node) {
  node.hidden = true;
  node.textContent = "";
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

function showSetup(message) {
  elements.form.hidden = true;
  elements.setupPanel.hidden = false;
  setStatus(elements.globalStatus, message, "error");
}

function selectedTagIds() {
  return [...elements.tagList.querySelectorAll('input[type="checkbox"]:checked')].map(
    (checkbox) => checkbox.value,
  );
}

function renderTags(tags) {
  clearChildren(elements.tagList);
  elements.tagList.setAttribute("aria-busy", "false");
  if (!tags.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No tags are available.";
    elements.tagList.appendChild(empty);
    return;
  }

  tags.forEach((tag, index) => {
    const label = document.createElement("label");
    label.className = "tag-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = tag.id;
    checkbox.id = `curio-tag-${index}`;
    checkbox.addEventListener("change", () => {
      if (selectedTagIds().length > MAX_SELECTED_TAGS) {
        checkbox.checked = false;
        setStatus(elements.formStatus, `Select no more than ${MAX_SELECTED_TAGS} tags.`, "error");
      } else {
        hideStatus(elements.formStatus);
      }
      indicator.textContent = checkbox.checked ? "✓" : "+";
      elements.tagCount.textContent = `${selectedTagIds().length} of ${MAX_SELECTED_TAGS} selected`;
    });

    const text = document.createElement("span");
    const indicator = document.createElement("span");
    indicator.className = "tag-indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.textContent = "+";
    const name = document.createElement("span");
    name.className = "tag-name";
    name.textContent = tag.name;
    text.append(indicator, name);
    label.append(checkbox, text);
    elements.tagList.appendChild(label);
  });
}

async function prefillActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const candidate = normalizeArticleUrl(tab.url);
    if (new URL(candidate).origin !== api.instanceUrl) elements.pageUrl.value = candidate;
  } catch {
    // Restricted browser pages cannot be read. The URL field remains editable.
  }
}

async function initialize() {
  elements.configure.addEventListener("click", openOptions);
  elements.openOptions.addEventListener("click", openOptions);
  elements.form.addEventListener("submit", submitEntry);

  await store.prepare();
  const settings = await store.load();
  if (!settings.instanceUrl || !settings.token) {
    showSetup("Configuration is required before this extension can connect.");
    return;
  }

  const permission = instancePermissionPattern(settings.instanceUrl);
  if (!(await chrome.permissions.contains({ origins: [permission] }))) {
    showSetup("Open settings and allow access to your Curio instance.");
    return;
  }

  api = new CurioApi(settings);
  try {
    const [profile, tagsPayload] = await Promise.all([api.getProfile(), api.getTags()]);
    const missingScopes = missingRequiredScopes(profile);
    if (missingScopes.length) {
      showSetup("Create a new browser connection key in Curio and try again.");
      return;
    }

    elements.profileLabel.textContent = profileLabel(profile);
    renderTags(tagsFromResponse(tagsPayload));
    await prefillActiveTab();
    elements.globalStatus.hidden = true;
    elements.setupPanel.hidden = true;
    elements.form.hidden = false;
  } catch (error) {
    showSetup(
      error instanceof CurioApiError ? error.message : "Could not initialize the extension.",
    );
  }
}

async function submitEntry(event) {
  event.preventDefault();
  hideStatus(elements.formStatus);

  let url;
  try {
    url = normalizeArticleUrl(elements.pageUrl.value);
  } catch (error) {
    setStatus(elements.formStatus, error.message, "error");
    elements.pageUrl.focus();
    return;
  }

  const tagIds = selectedTagIds();
  const sourceType = new FormData(elements.form).get("sourceType");
  if (sourceType !== "opensource" && sourceType !== "proprietary") {
    setStatus(elements.formStatus, "Choose a source type.", "error");
    return;
  }
  elements.submit.disabled = true;
  elements.submitLabel.textContent = "Submitting…";
  elements.submit.setAttribute("aria-busy", "true");

  try {
    await api.createEntry({
      url,
      sourceType,
      tagIds,
    });
    setStatus(elements.formStatus, "Saved to Curio.", "success");
    elements.submitLabel.textContent = "Saved";
  } catch (error) {
    setStatus(
      elements.formStatus,
      error instanceof CurioApiError ? error.message : "Could not save this page.",
      "error",
    );
    elements.submit.disabled = false;
    elements.submitLabel.textContent = "Submit";
  } finally {
    elements.submit.removeAttribute("aria-busy");
  }
}

initialize().catch(() => showSetup("Could not initialize the extension."));
