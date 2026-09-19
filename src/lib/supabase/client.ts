import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "@/lib/env/public";

type BrowserSupabaseClientOptions = {
  fetch?: typeof globalThis.fetch;
};

export function createBrowserSupabaseClient(options: BrowserSupabaseClientOptions = {}) {
  const environment = getPublicSupabaseEnv();

  return createBrowserClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    options.fetch ? { global: { fetch: options.fetch } } : undefined,
  );
}
