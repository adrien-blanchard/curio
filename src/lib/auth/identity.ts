import { getTrustedAvatarUrl } from "./avatar";

export type TrustedOAuthIdentity = {
  displayName: string | null;
  avatarUrl: string | null;
};

function normalizedDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > 120 || /[\p{Cc}\p{Cf}]/u.test(normalized)) {
    return null;
  }

  return normalized;
}

/**
 * Extracts the small, trusted identity snapshot Curio persists from Google
 * OAuth. Supabase user metadata remains untrusted input, so both fields are
 * normalized before reaching the database.
 */
export function getTrustedOAuthIdentity(value: unknown): TrustedOAuthIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { displayName: null, avatarUrl: null };
  }

  const metadata = value as Record<string, unknown>;
  const displayName =
    normalizedDisplayName(metadata.full_name) ?? normalizedDisplayName(metadata.name);
  const avatarUrl =
    getTrustedAvatarUrl(metadata.avatar_url) ?? getTrustedAvatarUrl(metadata.picture);

  return { displayName, avatarUrl };
}
