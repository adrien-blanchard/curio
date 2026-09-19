import { NextResponse } from "next/server";
import { getAuthEnv } from "@/lib/env/server";
import { isEmailAllowed, normalizeEmail } from "@/lib/auth/domain";
import { synchronizeAllowedEmailAccess } from "@/lib/auth/domain-configuration";
import { getTrustedOAuthIdentity } from "@/lib/auth/identity";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

function loginRedirect(origin: string, error: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  let environment: ReturnType<typeof getAuthEnv>;
  try {
    environment = getAuthEnv();
  } catch {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "SERVICE_NOT_CONFIGURED",
          message: "Authentication is not configured",
        },
      },
      { status: 503 },
    );
  }

  const code = new URL(request.url).searchParams.get("code");
  if (!code || code.length > 2048) {
    return loginRedirect(environment.APP_ORIGIN, "invalid_callback");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const user = data.user;

  if (error || !user?.email) {
    return loginRedirect(environment.APP_ORIGIN, "oauth_failed");
  }

  try {
    await synchronizeAllowedEmailAccess(
      environment.ALLOWED_EMAIL_DOMAINS,
      environment.ALLOWED_EMAIL_ADDRESSES,
    );
  } catch {
    await supabase.auth.signOut();
    return loginRedirect(environment.APP_ORIGIN, "account_unavailable");
  }
  if (
    !isEmailAllowed(
      user.email,
      environment.ALLOWED_EMAIL_DOMAINS,
      environment.ALLOWED_EMAIL_ADDRESSES,
    )
  ) {
    await supabase.auth.signOut();
    return loginRedirect(environment.APP_ORIGIN, "domain_not_allowed");
  }

  const email = normalizeEmail(user.email);
  const identity = getTrustedOAuthIdentity(user.user_metadata);
  const serviceRole = createServiceRoleClient();
  const { error: profileError } = await serviceRole.rpc("bootstrap_profile", {
    p_user_id: user.id,
    p_email: email,
    p_default_role: environment.DEFAULT_USER_ROLE,
    p_is_initial_administrator: environment.INITIAL_ADMIN_EMAILS.includes(email),
  });

  if (profileError) {
    console.error("[auth/callback] Profile bootstrap failed", {
      code: profileError.code,
    });
    await supabase.auth.signOut();
    return loginRedirect(environment.APP_ORIGIN, "account_unavailable");
  }

  const { error: identityError } = await serviceRole.rpc("sync_profile_identity", {
    p_user_id: user.id,
    p_display_name: identity.displayName,
    p_avatar_url: identity.avatarUrl,
  });

  if (identityError) {
    console.error("[auth/callback] Profile identity synchronization failed", {
      code: identityError.code,
    });
    await supabase.auth.signOut();
    return loginRedirect(environment.APP_ORIGIN, "account_unavailable");
  }

  return NextResponse.redirect(new URL("/dashboard", environment.APP_ORIGIN));
}
