import "server-only";

import { getAuthEnv } from "@/lib/env/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

const SYNCHRONIZATION_TTL_MS = 60_000;
const synchronizationByAccessSet = new Map<string, { promise: Promise<void>; expiresAt: number }>();

async function replaceAllowedEmailAccess(domains: string[], addresses: string[]): Promise<void> {
  const { error } = await createServiceRoleClient().rpc("replace_allowed_email_access", {
    p_domains: domains,
    p_addresses: addresses,
  });
  if (error) {
    throw new Error("Allowed email access synchronization failed.");
  }
}

/**
 * Keeps the database RLS allowlists aligned with the validated deployment
 * configuration. The RPC is service-role-only and replaces both sets atomically.
 */
export async function synchronizeAllowedEmailAccess(
  domains: readonly string[] = getAuthEnv().ALLOWED_EMAIL_DOMAINS,
  addresses: readonly string[] = getAuthEnv().ALLOWED_EMAIL_ADDRESSES,
): Promise<void> {
  const expectedDomains = [...new Set(domains.map((domain) => domain.trim().toLowerCase()))].sort();
  const expectedAddresses = [
    ...new Set(addresses.map((address) => address.trim().toLowerCase())),
  ].sort();
  const key = JSON.stringify({ domains: expectedDomains, addresses: expectedAddresses });
  const existing = synchronizationByAccessSet.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;

  const synchronization = replaceAllowedEmailAccess(expectedDomains, expectedAddresses).catch(
    (error: unknown) => {
      synchronizationByAccessSet.delete(key);
      throw error;
    },
  );
  synchronizationByAccessSet.set(key, {
    promise: synchronization,
    expiresAt: Date.now() + SYNCHRONIZATION_TTL_MS,
  });
  return synchronization;
}
