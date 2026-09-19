import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getAuthEnv } from "@/lib/env/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { isEmailAllowed, normalizeEmail } from "./domain";
import { synchronizeAllowedEmailAccess } from "./domain-configuration";
import { getTrustedOAuthIdentity } from "./identity";
import { appRoleSchema, type AppRole } from "./roles";

const activeProfileSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: appRoleSchema,
  is_active: z.literal(true),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
});

export type PageActor = {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  profile: {
    id: string;
    email: string;
    role: AppRole;
    isActive: true;
    displayName: string | null;
    avatarUrl: string | null;
  };
  role: AppRole;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
};

/**
 * Defense-in-depth authentication for Server Components and Server Actions.
 * The Proxy improves navigation UX, but protected code never trusts it as the
 * authorization boundary.
 */
export const getPageActor = cache(async (): Promise<PageActor | null> => {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) return null;

  const environment = getAuthEnv();
  try {
    await synchronizeAllowedEmailAccess(
      environment.ALLOWED_EMAIL_DOMAINS,
      environment.ALLOWED_EMAIL_ADDRESSES,
    );
  } catch {
    return null;
  }
  if (
    !isEmailAllowed(
      user.email,
      environment.ALLOWED_EMAIL_DOMAINS,
      environment.ALLOWED_EMAIL_ADDRESSES,
    )
  ) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, is_active, display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();
  const profile = activeProfileSchema.safeParse(data);
  if (error || !profile.success) return null;

  const metadataIdentity = getTrustedOAuthIdentity(user.user_metadata);
  const displayName = profile.data.display_name ?? metadataIdentity.displayName;
  const avatarUrl = profile.data.avatar_url ?? metadataIdentity.avatarUrl;

  return {
    user: {
      id: user.id,
      email: normalizeEmail(user.email),
      displayName,
      avatarUrl,
    },
    profile: {
      id: profile.data.id,
      email: normalizeEmail(profile.data.email),
      role: profile.data.role,
      isActive: true,
      displayName,
      avatarUrl,
    },
    role: profile.data.role,
    supabase,
  };
});

export async function requirePageActor(): Promise<PageActor> {
  const actor = await getPageActor();
  if (!actor) redirect("/login");
  return actor;
}
