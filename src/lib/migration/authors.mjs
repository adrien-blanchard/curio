import { normalizeEmail } from "./redaction.mjs";

function normalizedDisplayName(value) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > 120 || /[\p{Cc}\p{Cf}]/u.test(normalized)) return null;
  return normalized;
}

function normalizedGoogleAvatarUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hostname.toLowerCase() !== "lh3.googleusercontent.com" ||
      url.toString().length > 2_048
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveInitialAdministrator({ targetProfiles, initialAdminEmails }) {
  const targetByEmail = new Map(
    targetProfiles
      .map((profile) => [normalizeEmail(profile.email), profile])
      .filter(([email, profile]) => email && profile?.id),
  );
  const administrator = initialAdminEmails
    .map(normalizeEmail)
    .filter(Boolean)
    .map((email) => targetByEmail.get(email))
    .find((profile) => profile?.role === "administrator");

  if (!administrator) {
    throw new Error(
      "No listed initial administrator matches an administrator profile in the target.",
    );
  }
  return administrator;
}

export function createAuthorMapper({
  sourceProfiles,
  targetProfiles,
  initialAdminEmails,
  initialAdministrator = resolveInitialAdministrator({ targetProfiles, initialAdminEmails }),
}) {
  const sourceEmailById = new Map(
    sourceProfiles
      .map((profile) => [String(profile.id), normalizeEmail(profile.email)])
      .filter(([, email]) => email),
  );
  const targetByEmail = new Map(
    targetProfiles
      .map((profile) => [normalizeEmail(profile.email), profile])
      .filter(([email, profile]) => email && profile?.id),
  );

  return function mapAuthor(sourceProfileId) {
    const sourceEmail = sourceEmailById.get(String(sourceProfileId ?? ""));
    const exactMatch = sourceEmail ? targetByEmail.get(sourceEmail) : null;
    return exactMatch?.id ?? initialAdministrator.id;
  };
}

export function createAttributionMapper({ sourceProfiles, overrides = [] }) {
  if (!Array.isArray(overrides)) {
    throw new Error("MIGRATION_ATTRIBUTION_CONFIGURATION_INVALID");
  }

  const overridesBySourceId = new Map();
  for (const override of overrides) {
    const sourceProfileId =
      typeof override?.sourceProfileId === "string" ? override.sourceProfileId.trim() : "";
    const hasDisplayName = override && Object.hasOwn(override, "displayName");
    const hasAvatarUrl = override && Object.hasOwn(override, "avatarUrl");
    const displayName = hasDisplayName ? normalizedDisplayName(override.displayName) : undefined;
    const avatarUrl = hasAvatarUrl ? normalizedGoogleAvatarUrl(override.avatarUrl) : undefined;

    if (
      !sourceProfileId ||
      sourceProfileId.length > 256 ||
      overridesBySourceId.has(sourceProfileId) ||
      (hasDisplayName && override.displayName !== null && displayName === null) ||
      (hasAvatarUrl && override.avatarUrl !== null && avatarUrl === null)
    ) {
      throw new Error("MIGRATION_ATTRIBUTION_CONFIGURATION_INVALID");
    }
    overridesBySourceId.set(sourceProfileId, { displayName, avatarUrl });
  }

  const sourceById = new Map(
    sourceProfiles.map((profile) => {
      const override = overridesBySourceId.get(String(profile.id));
      return [
        String(profile.id),
        Object.freeze({
          email: normalizeEmail(profile.email),
          displayName:
            override?.displayName === undefined
              ? normalizedDisplayName(profile.displayName)
              : override.displayName,
          avatarUrl:
            override?.avatarUrl === undefined
              ? normalizedGoogleAvatarUrl(profile.avatarUrl)
              : override.avatarUrl,
        }),
      ];
    }),
  );

  if ([...overridesBySourceId.keys()].some((sourceId) => !sourceById.has(sourceId))) {
    throw new Error("MIGRATION_ATTRIBUTION_CONFIGURATION_INVALID");
  }

  return function mapAttribution(sourceProfileId) {
    const attribution = sourceById.get(String(sourceProfileId ?? ""));
    return attribution?.email ? attribution : null;
  };
}
