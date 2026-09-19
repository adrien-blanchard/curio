import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import GoogleSignInButton from "@/components/GoogleSignInButton";
import { getPublicEnv, isBackendConfigured } from "@/lib/env/public";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const loginErrors: Record<string, string> = {
  account_unavailable: "This account is not active on this Curio instance.",
  configuration_unavailable: "Authentication has not been configured yet.",
  domain_not_allowed: "This email domain is not allowed on this Curio instance.",
  invalid_callback: "The sign-in response could not be verified. Please try again.",
  oauth_failed: "Google sign-in could not be completed. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const environment = getPublicEnv();
  const backendConfigured = isBackendConfigured();
  if (backendConfigured) {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/dashboard");
  }

  const parameters = await searchParams;
  const errorCode = typeof parameters.error === "string" ? parameters.error : null;
  const errorMessage = errorCode
    ? (loginErrors[errorCode] ?? "Sign-in could not be completed.")
    : null;
  const organization = environment.NEXT_PUBLIC_ORGANIZATION_NAME.trim();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background bg-noise px-4 py-10">
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-card p-8 shadow-md">
        <div className="relative z-10 flex flex-col items-center text-center">
          <Image
            src="/curio-logo.svg"
            alt=""
            width={64}
            height={64}
            priority
            className="mb-6 h-16 w-16 object-contain drop-shadow-sm"
          />

          <h1 className="mb-2 text-2xl font-bold tracking-tight text-[#1B254B]">
            Sign in to {environment.NEXT_PUBLIC_APP_NAME}
          </h1>
          <p className="mb-8 text-sm font-medium text-[#718096]">
            {organization
              ? `Use an account approved by ${organization}.`
              : "Use an account approved by this Curio instance."}
          </p>

          {errorMessage ? (
            <div
              role="alert"
              className="mb-6 w-full rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700"
            >
              {errorMessage}
            </div>
          ) : null}

          {backendConfigured ? (
            <div className="w-full">
              <GoogleSignInButton />
            </div>
          ) : (
            <div
              role="status"
              className="w-full rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900"
            >
              Authentication is not configured. Complete the environment and Supabase setup before
              signing in.
            </div>
          )}

          <nav className="mt-8 flex items-center justify-center gap-4 text-xs font-bold text-[#47548C]">
            {environment.NEXT_PUBLIC_DEMO_ENABLED ? (
              <Link
                href="/demo"
                className="rounded-md underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                View demo
              </Link>
            ) : null}
            <Link
              href="/privacy"
              className="rounded-md underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Privacy
            </Link>
          </nav>
        </div>
      </div>
    </main>
  );
}
