const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/giu,
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*[^\s,;]{8,}/giu,
  /\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
];
const MIGRATION_EMAIL_LOCAL_PART = /^[-a-z0-9_+'.]*[-a-z0-9_+]$/u;
const MIGRATION_EMAIL_DOMAIN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/u;

export function redactText(input) {
  if (input === null || input === undefined) return null;
  let value = String(input).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "");
  for (const pattern of SECRET_PATTERNS) value = value.replace(pattern, "[REDACTED]");
  return value;
}

export function safeString(input, { maximumLength = 20_000, nullable = true } = {}) {
  if (input === null || input === undefined || input === "") return nullable ? null : "";
  return redactText(input).slice(0, maximumLength);
}

export function normalizeEmail(input) {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length < 3 || email.length > 320) return null;
  const separator = email.indexOf("@");
  if (separator < 1 || separator !== email.lastIndexOf("@")) return null;
  const localPart = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  return localPart.length <= 64 &&
    MIGRATION_EMAIL_LOCAL_PART.test(localPart) &&
    !localPart.startsWith(".") &&
    !localPart.endsWith(".") &&
    !localPart.includes("..") &&
    MIGRATION_EMAIL_DOMAIN.test(domain)
    ? email
    : null;
}
