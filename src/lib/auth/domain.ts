export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string | null | undefined) {
  if (!email) return null;
  const normalized = normalizeEmail(email);
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0 || separator === normalized.length - 1) return null;
  return normalized.slice(separator + 1);
}

/** Exact, case-insensitive domain comparison. Subdomains are not implicit. */
export function isEmailAllowed(
  email: string | null | undefined,
  allowedDomains: readonly string[],
  allowedAddresses: readonly string[],
) {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  const domain = emailDomain(email);
  if (!domain) return false;
  return (
    allowedAddresses.some((allowedAddress) => normalizeEmail(allowedAddress) === normalized) ||
    allowedDomains.some((allowedDomain) => allowedDomain.trim().toLowerCase() === domain)
  );
}
