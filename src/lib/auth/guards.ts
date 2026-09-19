import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";
import { getAuthEnv } from "@/lib/env/server";
import { createAnonymousSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { assertCsrfOrigin } from "./csrf";
import { isEmailAllowed, normalizeEmail } from "./domain";
import { synchronizeAllowedEmailAccess } from "./domain-configuration";
import { AuthenticationError } from "./errors";
import {
  API_TOKEN_SCOPES,
  apiTokenScopeSchema,
  appRoleSchema,
  scopesForRole,
  type ApiTokenScope,
  type AppRole,
} from "./roles";
import { hashApiToken, isApiToken } from "./tokens";

const tokenIdentitySchema = z.object({
  token_id: z.uuid(),
  user_id: z.uuid(),
  email: z.email(),
  role: appRoleSchema,
  scopes: z.array(apiTokenScopeSchema),
});

export type AuthenticatedActor = {
  mode: "cookie" | "api_token";
  user: Pick<User, "id" | "email">;
  profile: {
    id: string;
    email: string;
    role: AppRole;
    isActive: true;
  };
  role: AppRole;
  scopes: readonly ApiTokenScope[];
  tokenId: string | null;
  /** Present only in server memory for token-scoped RPCs. Never serialize it. */
  tokenHash: string | null;
  supabase: SupabaseClient;
};

export type AuthenticateRequestOptions = {
  roles?: readonly AppRole[];
  scopes?: readonly ApiTokenScope[];
  allowCookie?: boolean;
  allowApiToken?: boolean;
  requireCsrf?: boolean;
};

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

async function authenticateApiToken(
  rawToken: string,
  requiredScopes: readonly ApiTokenScope[],
): Promise<AuthenticatedActor> {
  if (!isApiToken(rawToken)) {
    throw new AuthenticationError("INVALID_API_TOKEN", "Invalid API token");
  }

  const tokenHash = hashApiToken(rawToken);
  const supabase = createAnonymousSupabaseClient();
  const { data, error } = await supabase
    .rpc("authenticate_api_token", {
      p_token_hash: tokenHash,
      p_required_scopes: [...requiredScopes],
    })
    .maybeSingle();

  if (error || !data) {
    throw new AuthenticationError("INVALID_API_TOKEN", "Invalid API token");
  }

  const identity = tokenIdentitySchema.safeParse(data);
  if (!identity.success) {
    throw new AuthenticationError("INVALID_API_TOKEN", "Invalid API token");
  }

  const environment = getAuthEnv();
  await synchronizeAllowedEmailAccess(
    environment.ALLOWED_EMAIL_DOMAINS,
    environment.ALLOWED_EMAIL_ADDRESSES,
  );
  if (
    !isEmailAllowed(
      identity.data.email,
      environment.ALLOWED_EMAIL_DOMAINS,
      environment.ALLOWED_EMAIL_ADDRESSES,
    )
  ) {
    throw new AuthenticationError("DOMAIN_NOT_ALLOWED", "Email domain is not allowed", 403);
  }

  return {
    mode: "api_token",
    user: { id: identity.data.user_id, email: identity.data.email },
    profile: {
      id: identity.data.user_id,
      email: normalizeEmail(identity.data.email),
      role: identity.data.role,
      isActive: true,
    },
    role: identity.data.role,
    scopes: identity.data.scopes,
    tokenId: identity.data.token_id,
    tokenHash,
    supabase,
  };
}

async function authenticateCookie(
  request: Request,
  requireCsrf: boolean,
): Promise<AuthenticatedActor> {
  if (requireCsrf) assertCsrfOrigin(request);

  const environment = getAuthEnv();
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user || !user.email) {
    throw new AuthenticationError("AUTHENTICATION_REQUIRED", "Authentication required");
  }

  await synchronizeAllowedEmailAccess(
    environment.ALLOWED_EMAIL_DOMAINS,
    environment.ALLOWED_EMAIL_ADDRESSES,
  );

  if (
    !isEmailAllowed(
      user.email,
      environment.ALLOWED_EMAIL_DOMAINS,
      environment.ALLOWED_EMAIL_ADDRESSES,
    )
  ) {
    throw new AuthenticationError("DOMAIN_NOT_ALLOWED", "Email domain is not allowed", 403);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  const parsedProfile = z
    .object({
      id: z.uuid(),
      email: z.email(),
      role: appRoleSchema,
      is_active: z.literal(true),
    })
    .safeParse(profile);

  if (profileError || !parsedProfile.success) {
    throw new AuthenticationError("ACCOUNT_UNAVAILABLE", "Account profile is unavailable", 403);
  }

  return {
    mode: "cookie",
    user: { id: user.id, email: normalizeEmail(user.email) },
    profile: {
      id: parsedProfile.data.id,
      email: normalizeEmail(parsedProfile.data.email),
      role: parsedProfile.data.role,
      isActive: true,
    },
    role: parsedProfile.data.role,
    scopes: scopesForRole(parsedProfile.data.role),
    tokenId: null,
    tokenHash: null,
    supabase,
  };
}

export function requireRole(actor: AuthenticatedActor, allowedRoles: readonly AppRole[]) {
  if (!allowedRoles.includes(actor.role)) {
    throw new AuthenticationError(
      "INSUFFICIENT_ROLE",
      "This account role cannot perform the requested operation",
      403,
    );
  }
  return actor;
}

export function requireScopes(actor: AuthenticatedActor, requiredScopes: readonly ApiTokenScope[]) {
  const granted = new Set(actor.scopes);
  if (!requiredScopes.every((scope) => granted.has(scope))) {
    throw new AuthenticationError(
      "INSUFFICIENT_SCOPE",
      "The API token does not grant the required scope",
      403,
    );
  }
  return actor;
}

export async function authenticateRequest(
  request: Request,
  options: AuthenticateRequestOptions = {},
) {
  const {
    roles,
    scopes = [],
    allowCookie = true,
    allowApiToken = true,
    requireCsrf = false,
  } = options;

  const token = bearerToken(request);
  let actor: AuthenticatedActor;

  if (token) {
    if (!allowApiToken) {
      throw new AuthenticationError("AUTHENTICATION_REQUIRED", "A browser session is required");
    }
    actor = await authenticateApiToken(token, scopes);
  } else {
    if (!allowCookie) {
      throw new AuthenticationError("AUTHENTICATION_REQUIRED", "An API token is required");
    }
    actor = await authenticateCookie(request, requireCsrf);
  }

  if (roles) requireRole(actor, roles);
  requireScopes(actor, scopes);
  return actor;
}

export const ALL_API_TOKEN_SCOPES: readonly ApiTokenScope[] = API_TOKEN_SCOPES;
