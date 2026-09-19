const MAX_URL_LENGTH = 2_048;
const BLOCKED_HOST_SUFFIXES = [
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".onion",
  ".test",
];
const REMOVED_QUERY_PARAMETERS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "client_secret",
  "code",
  "credential",
  "dclid",
  "fbclid",
  "gclid",
  "igshid",
  "jwt",
  "key",
  "mc_cid",
  "mc_eid",
  "oauth_token",
  "password",
  "ref_src",
  "session",
  "sig",
  "signature",
  "token",
]);
const REMOVED_QUERY_PREFIXES = ["utm_", "mc_", "pk_", "x-amz-", "x-goog-"];

export class PublicUrlError extends Error {
  constructor(
    readonly code:
      | "INVALID_URL"
      | "UNSUPPORTED_PROTOCOL"
      | "CREDENTIALS_NOT_ALLOWED"
      | "NON_STANDARD_PORT"
      | "PRIVATE_HOST"
      | "UNRESOLVABLE_HOST",
    message: string,
  ) {
    super(message);
    this.name = "PublicUrlError";
  }
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => Number(part));
  return octets.every(
    (octet, index) =>
      Number.isInteger(octet) && octet >= 0 && octet <= 255 && String(octet) === parts[index],
  )
    ? octets
    : null;
}

function isPublicIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;

  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return a > 0 && a < 224;
}

function parseIpv6(address: string): number[] | null {
  const normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (!normalized || normalized.includes("%") || normalized.split("::").length > 2) return null;

  let value = normalized;
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    if (lastColon < 0) return null;
    const ipv4 = parseIpv4(value.slice(lastColon + 1));
    if (!ipv4) return null;
    value = `${value.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }

  const hasCompression = value.includes("::");
  const [left = "", right = ""] = value.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  if ([...leftParts, ...rightParts].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }

  const missing = 8 - leftParts.length - rightParts.length;
  if ((!hasCompression && missing !== 0) || (hasCompression && missing < 1)) return null;

  const parts = [...leftParts, ...Array.from({ length: missing }, () => "0"), ...rightParts];
  if (parts.length !== 8) return null;

  return parts.map((part) => Number.parseInt(part, 16));
}

function isPublicIpv6(address: string): boolean {
  const groups = parseIpv6(address);
  if (!groups) return false;

  // Public IPv6 unicast space is currently 2000::/3. This intentionally
  // rejects mapped IPv4, loopback, link-local, unique-local and multicast.
  if ((groups[0] & 0xe000) !== 0x2000) return false;

  // Documentation, Teredo and ORCHID ranges are not valid public targets.
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return false;
  if (groups[0] === 0x2001 && groups[1] === 0x0000) return false;
  if (groups[0] === 0x2001 && (groups[1] & 0xfff0) === 0x0010) return false;
  return true;
}

/** Returns the address family without relying on a Node.js built-in. */
export function getIpAddressFamily(address: string): 0 | 4 | 6 {
  const normalized = address.replace(/^\[|\]$/g, "");
  if (parseIpv4(normalized)) return 4;
  if (parseIpv6(normalized)) return 6;
  return 0;
}

export function isPublicIpAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "");
  const family = getIpAddressFamily(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family === 6) return isPublicIpv6(normalized);
  return false;
}

export function normalizedHostname(url: URL): string {
  return url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

function assertSyntacticallyPublic(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PublicUrlError(
      "UNSUPPORTED_PROTOCOL",
      "Only public HTTP and HTTPS URLs are supported.",
    );
  }
  if (url.username || url.password) {
    throw new PublicUrlError(
      "CREDENTIALS_NOT_ALLOWED",
      "URLs containing credentials are not allowed.",
    );
  }
  if (
    url.port &&
    !(
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    )
  ) {
    throw new PublicUrlError(
      "NON_STANDARD_PORT",
      "Only the standard HTTP and HTTPS ports are allowed.",
    );
  }

  const hostname = normalizedHostname(url);
  const ipFamily = getIpAddressFamily(hostname);
  if (
    !hostname ||
    hostname === "localhost" ||
    (ipFamily === 0 && !hostname.includes(".")) ||
    BLOCKED_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
    )
  ) {
    throw new PublicUrlError("PRIVATE_HOST", "The URL must use a publicly resolvable hostname.");
  }

  if (ipFamily !== 0 && !isPublicIpAddress(hostname)) {
    throw new PublicUrlError(
      "PRIVATE_HOST",
      "Private, local and reserved IP addresses are not allowed.",
    );
  }
}

export function canonicalizeUrl(input: string): string {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_URL_LENGTH) {
    throw new PublicUrlError("INVALID_URL", "Provide a valid URL up to 2,048 characters.");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PublicUrlError("INVALID_URL", "Provide a valid absolute URL.");
  }
  assertSyntacticallyPublic(url);

  const hostname = normalizedHostname(url);
  const youtubeId = getYouTubeVideoId(url);
  if (youtubeId) return `https://www.youtube.com/watch?v=${youtubeId}`;

  url.hostname = hostname;
  url.hash = "";
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  for (const key of [...url.searchParams.keys()]) {
    const normalizedKey = key.toLowerCase();
    if (
      REMOVED_QUERY_PARAMETERS.has(normalizedKey) ||
      REMOVED_QUERY_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix)) ||
      /(?:credential|password|secret|signature|token)/u.test(normalizedKey)
    ) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function getYouTubeVideoId(input: URL | string): string | null {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : input;
  } catch {
    return null;
  }

  const hostname = normalizedHostname(url);
  let id: string | null = null;
  if (hostname === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? null;
  if (
    hostname === "youtube.com" ||
    hostname === "www.youtube.com" ||
    hostname === "m.youtube.com"
  ) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    if (/^\/(?:embed|shorts)\//.test(url.pathname)) {
      id = url.pathname.split("/").filter(Boolean)[1] ?? null;
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}
