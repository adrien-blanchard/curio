const REMOVED_QUERY_NAMES = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "client_secret",
  "code",
  "credential",
  "fbclid",
  "gclid",
  "jwt",
  "key",
  "oauth_token",
  "password",
  "session",
  "sig",
  "signature",
  "token",
]);

const REMOVED_QUERY_PREFIXES = ["utm_", "mc_", "pk_", "x-amz-", "x-goog-"];

function shouldRemoveQueryParameter(name) {
  const normalized = name.toLowerCase();
  return (
    REMOVED_QUERY_NAMES.has(normalized) ||
    REMOVED_QUERY_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    /(?:credential|password|secret|signature|token)/u.test(normalized)
  );
}

export function canonicalizeUrl(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new TypeError("A non-empty URL is required.");
  }

  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new TypeError("The URL is invalid.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError("Only HTTP and HTTPS URLs can be migrated.");
  }
  if (parsed.username || parsed.password) {
    throw new TypeError("URLs containing credentials cannot be migrated.");
  }

  parsed.hostname = parsed.hostname.toLowerCase();
  if (
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80")
  ) {
    parsed.port = "";
  }
  parsed.hash = "";

  const retained = [...parsed.searchParams.entries()]
    .filter(([name]) => !shouldRemoveQueryParameter(name))
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      const nameComparison = leftName.localeCompare(rightName, "en");
      return nameComparison || leftValue.localeCompare(rightValue, "en");
    });
  parsed.search = "";
  for (const [name, value] of retained) parsed.searchParams.append(name, value);

  if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  const canonical = parsed.toString();
  if (canonical.length > 4_096) throw new TypeError("The URL exceeds Curio's storage limit.");
  return canonical;
}

export function tryCanonicalizeUrl(input) {
  try {
    return canonicalizeUrl(input);
  } catch {
    return null;
  }
}
