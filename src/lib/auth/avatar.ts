const TRUSTED_AVATAR_HOSTS = new Set(["lh3.googleusercontent.com"]);

/**
 * Accept only the HTTPS avatar host returned by Google OAuth. User metadata is
 * untrusted input and must not become an arbitrary browser request.
 */
export function getTrustedAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !TRUSTED_AVATAR_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
