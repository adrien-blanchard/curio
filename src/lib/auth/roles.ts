import { z } from "zod";

export const APP_ROLES = ["reader", "contributor", "administrator"] as const;
export const appRoleSchema = z.enum(APP_ROLES);
export type AppRole = z.infer<typeof appRoleSchema>;

export const API_TOKEN_SCOPES = ["entries:write", "tags:read", "profile:read"] as const;
export const apiTokenScopeSchema = z.enum(API_TOKEN_SCOPES);
export type ApiTokenScope = z.infer<typeof apiTokenScopeSchema>;

const roleScopes: Record<AppRole, readonly ApiTokenScope[]> = {
  reader: ["tags:read", "profile:read"],
  contributor: ["entries:write", "tags:read", "profile:read"],
  administrator: ["entries:write", "tags:read", "profile:read"],
};

export function isAppRole(value: unknown): value is AppRole {
  return appRoleSchema.safeParse(value).success;
}

export function scopesForRole(role: AppRole): readonly ApiTokenScope[] {
  return roleScopes[role];
}

export function roleCanUseScopes(role: AppRole, scopes: readonly ApiTokenScope[]) {
  const allowed = new Set(roleScopes[role]);
  return scopes.every((scope) => allowed.has(scope));
}
