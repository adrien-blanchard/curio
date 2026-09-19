import { createClient } from "@supabase/supabase-js";

const apply = process.argv.slice(2).includes("--apply");
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+$/u;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function configuredValues(name) {
  return [
    ...new Set(
      (process.env[name] ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
}

function validEmailAddress(address) {
  if (!emailPattern.test(address) || address.length > 320) return false;
  const [localPart, domain] = address.split("@");
  return (
    localPart.length <= 64 &&
    !localPart.startsWith(".") &&
    !localPart.endsWith(".") &&
    !localPart.includes("..") &&
    domainPattern.test(domain)
  );
}

function configuredAccess() {
  const domains = configuredValues("ALLOWED_EMAIL_DOMAINS");
  const addresses = configuredValues("ALLOWED_EMAIL_ADDRESSES");

  if (domains.length > 100 || domains.some((domain) => !domainPattern.test(domain))) {
    throw new Error("ALLOWED_EMAIL_DOMAINS must contain 0-100 exact DNS domains.");
  }
  if (addresses.length > 100 || addresses.some((address) => !validEmailAddress(address))) {
    throw new Error("ALLOWED_EMAIL_ADDRESSES must contain 0-100 exact email addresses.");
  }
  if (domains.length + addresses.length === 0) {
    throw new Error(
      "At least one ALLOWED_EMAIL_DOMAINS or ALLOWED_EMAIL_ADDRESSES value is required.",
    );
  }

  return { domains, addresses };
}

async function main() {
  const { domains, addresses } = configuredAccess();
  if (!apply) {
    process.stdout.write(
      `Dry run: ${domains.length} allowed email domain(s) validated; ${addresses.length} exact email address(es) validated. Re-run with --apply to synchronize Supabase.\n`,
    );
    return;
  }

  const supabaseUrl = new URL(required("NEXT_PUBLIC_SUPABASE_URL"));
  if (!["http:", "https:"].includes(supabaseUrl.protocol)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTP or HTTPS.");
  }
  const client = createClient(supabaseUrl.origin, required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.rpc("replace_allowed_email_access", {
    p_domains: domains,
    p_addresses: addresses,
  });
  if (error) throw new Error("Supabase rejected the allowed email-access configuration.");

  process.stdout.write(
    `Synchronized ${domains.length} allowed email domain(s) and ${addresses.length} exact email address(es).\n`,
  );
}

await main();
