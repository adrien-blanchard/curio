export const USER_ROLES = ["reader", "contributor", "administrator"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: string): value is UserRole {
  return USER_ROLES.some((role) => role === value);
}

export const ENTRY_STATUSES = ["queued", "analyzing", "finalizing", "ready", "failed"] as const;

export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export type SourceType = "opensource" | "proprietary";

export type ThumbnailOrigin = "automatic" | "manual" | "placeholder";

export type CurioTag = {
  id: string;
  name: string;
  slug: string;
  color: string;
};

export type CurioEntry = {
  sourcePublishedAt?: string | null;
  sourceDateKind?: import("@/lib/ui/source-age").SourceDateKind | null;
  sourceDateOrigin?: "ai" | "manual" | null;
  id: string;
  title: string | null;
  url: string;
  tldr: string | null;
  thumbnailUrl: string | null;
  status: EntryStatus;
  sourceType: SourceType;
  tags: CurioTag[];
  createdAt: string;
  createdBy?: string | null;
  authorEmail?: string | null;
  authorDisplayName?: string | null;
  authorAvatarUrl?: string | null;
  processingHeartbeatAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  thumbnailOrigin?: ThumbnailOrigin | null;
};

export type ApiError = {
  code?: string;
  message: string;
  details?: unknown;
};

export type ApiEnvelope<T> = {
  data: T | null;
  error: ApiError | null;
};

export function canSubmit(role: UserRole): boolean {
  return role === "contributor" || role === "administrator";
}

export function canAdminister(role: UserRole): boolean {
  return role === "administrator";
}

export function canManageEntry(
  role: UserRole,
  currentUserId: string | undefined,
  createdBy: string | null | undefined,
): boolean {
  if (role === "administrator") return true;
  return role === "contributor" && Boolean(currentUserId) && currentUserId === createdBy;
}
