import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getPublicSupabaseEnv } from "@/lib/env/public";
import { getAuthEnv } from "@/lib/env/server";
import { fetchWithTimeout } from "@/lib/http/fetch-with-timeout";
import { WORKFLOW_SUPABASE_REQUEST_TIMEOUT_MS } from "@/lib/workflows/timeouts";

const nonPersistentAuth = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

type ServiceRoleClientOptions = {
  fetch?: typeof globalThis.fetch;
};

export async function createServerSupabaseClient() {
  const environment = getPublicSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set response cookies. Proxy refreshes them.
          }
        },
      },
    },
  );
}

export function createAnonymousSupabaseClient() {
  const environment = getPublicSupabaseEnv();

  return createSupabaseJsClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: nonPersistentAuth },
  );
}

export function createServiceRoleClient(options: ServiceRoleClientOptions = {}) {
  const environment = getAuthEnv();

  return createSupabaseJsClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: nonPersistentAuth,
      ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
    },
  );
}

export function createWorkflowServiceRoleClient() {
  return createServiceRoleClient({
    fetch: (input, init) =>
      fetchWithTimeout(input, init, {
        timeoutMs: WORKFLOW_SUPABASE_REQUEST_TIMEOUT_MS,
        timeoutMessage: "The workflow database request timed out.",
      }),
  });
}

/**
 * Supabase access-token client kept for web-session interoperability.
 * Public API tokens use database-backed PAT authentication instead.
 */
export function createBearerSupabaseClient(accessToken: string) {
  const environment = getPublicSupabaseEnv();

  return createSupabaseJsClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: nonPersistentAuth,
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    },
  );
}
