import { describe, expect, it } from "vitest";

import {
  API_TOKEN_SCOPES,
  APP_ROLES,
  isAppRole,
  roleCanUseScopes,
  scopesForRole,
} from "@/lib/auth/roles";

describe("application roles", () => {
  it("accepts only the three public role names", () => {
    expect(APP_ROLES).toEqual(["reader", "contributor", "administrator"]);
    for (const role of APP_ROLES) expect(isAppRole(role)).toBe(true);
    for (const legacyOrInvalid of ["viewer", "editor", "admin", "Reader", "", null, 1]) {
      expect(isAppRole(legacyOrInvalid)).toBe(false);
    }
  });

  it("grants readers read scopes but never entry submission", () => {
    expect(scopesForRole("reader")).toEqual(["tags:read", "profile:read"]);
    expect(roleCanUseScopes("reader", ["tags:read", "profile:read"])).toBe(true);
    expect(roleCanUseScopes("reader", ["entries:write"])).toBe(false);
  });

  it.each(["contributor", "administrator"] as const)(
    "%s can use every currently defined personal-token scope",
    (role) => {
      expect(roleCanUseScopes(role, API_TOKEN_SCOPES)).toBe(true);
      expect(scopesForRole(role)).toEqual(API_TOKEN_SCOPES);
    },
  );

  it("treats an empty requested scope set as least privilege", () => {
    for (const role of APP_ROLES) expect(roleCanUseScopes(role, [])).toBe(true);
  });
});
