import AuthorAvatar from "@/components/AuthorAvatar";
import RoleBadge from "@/components/RoleBadge";
import SignOutButton from "@/components/SignOutButton";
import { requirePageActor } from "@/lib/auth/page";
import { scopesForRole } from "@/lib/auth/roles";
import { getOptionalServerMetadata } from "@/lib/env/server";

import PersonalAccessTokens from "./PersonalAccessTokens";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const actor = await requirePageActor();
  const metadata = getOptionalServerMetadata();
  const extensionEnabled = metadata.EXTENSION_ENABLED && actor.role !== "reader";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="mt-4">
        <h1 className="text-[32px] font-extrabold leading-tight tracking-tight text-[#1B254B]">
          My Account
        </h1>
        <p className="mt-1 text-[15px] font-medium text-[#718096]">
          Your profile and current Curio access.
        </p>
      </header>

      <section
        aria-labelledby="profile-heading"
        className="rounded-[24px] border border-border bg-white p-6 shadow-soft"
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <AuthorAvatar email={actor.user.email} src={actor.user.avatarUrl} size={64} />
            <div className="min-w-0">
              <h2 id="profile-heading" className="truncate text-xl font-extrabold text-[#1B254B]">
                {actor.user.displayName ?? actor.user.email}
              </h2>
              <p className="truncate text-sm font-medium text-[#718096]">{actor.user.email}</p>
              <RoleBadge role={actor.role} className="mt-2" />
            </div>
          </div>
          <div className="w-full sm:w-44">
            <SignOutButton />
          </div>
        </div>
      </section>

      {extensionEnabled ? (
        <details className="overflow-hidden rounded-[24px] border border-border bg-white shadow-soft">
          <summary className="cursor-pointer px-5 py-4 text-sm font-extrabold text-[#47548C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-6">
            Browser extension
            <span className="ml-2 font-medium text-[#718096]">Install or manage this device</span>
          </summary>
          <div className="border-t border-border p-5 sm:p-6">
            <PersonalAccessTokens
              allowedScopes={[...scopesForRole(actor.role)]}
              installUrl={metadata.NEXT_PUBLIC_EXTENSION_INSTALL_URL}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}
