export const REQUIRED_SCOPES = Object.freeze(["entries:write", "tags:read", "profile:read"]);

export const MAX_SELECTED_TAGS = 10;
// Keep the browser contract aligned with POST /api/v1/entries.
export const MAX_ARTICLE_URL_LENGTH = 2_048;

const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function normalizeInstanceUrl(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) {
    throw new TypeError("Enter your Curio instance URL.");
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("Enter a valid Curio instance URL.");
  }

  if (url.username || url.password) {
    throw new TypeError("The instance URL must not contain credentials.");
  }

  const isSecure = url.protocol === "https:";
  const isLocalHttp = url.protocol === "http:" && LOCAL_HTTP_HOSTS.has(url.hostname);
  if (!isSecure && !isLocalHttp) {
    throw new TypeError("Use HTTPS. HTTP is allowed only for localhost development.");
  }
  if (url.search || url.hash) {
    throw new TypeError("The instance URL must not contain a query or fragment.");
  }
  if (url.pathname !== "/") {
    throw new TypeError("Use the instance origin only, without a path.");
  }

  return url.origin;
}

export function instancePermissionPattern(instanceUrl) {
  const origin = normalizeInstanceUrl(instanceUrl);
  const url = new URL(origin);
  // Chrome match patterns do not include ports; an exact host pattern covers
  // every port while the API client still connects to the configured origin.
  return `${url.protocol}//${url.hostname}/*`;
}

export function normalizePersonalToken(rawValue) {
  const token = String(rawValue ?? "").trim();
  if (!token) {
    throw new TypeError("Enter a Curio connection key.");
  }
  if (/^Bearer\s/i.test(token)) {
    throw new TypeError("Paste the connection key only, without the Bearer prefix.");
  }
  if (token.length < 20 || token.length > 4_096 || /[\s\u0000-\u001f\u007f]/u.test(token)) {
    throw new TypeError("The connection key format is invalid.");
  }
  return token;
}

export function normalizeArticleUrl(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (!raw || raw.length > MAX_ARTICLE_URL_LENGTH) {
    throw new TypeError("Enter a valid page URL.");
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("Enter a valid page URL.");
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new TypeError("Only HTTP and HTTPS page URLs are supported.");
  }

  url.hash = "";
  return url.href;
}

export function scopesFromProfile(payload) {
  const candidates = [
    payload?.scopes,
    payload?.data?.scopes,
    payload?.user?.scopes,
    payload?.data?.user?.scopes,
  ];
  const candidate = candidates.find((value) => Array.isArray(value) || typeof value === "string");
  if (Array.isArray(candidate)) {
    return [...new Set(candidate.filter((scope) => typeof scope === "string"))];
  }
  if (typeof candidate === "string") {
    return [...new Set(candidate.split(/[\s,]+/u).filter(Boolean))];
  }
  return [];
}

export function missingRequiredScopes(payload) {
  const granted = new Set(scopesFromProfile(payload));
  return REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
}
