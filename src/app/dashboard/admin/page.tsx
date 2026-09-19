import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRoundPlus } from "lucide-react";
import { z } from "zod";

import AdminTable, { type AdminUserProfile } from "@/components/AdminTable";
import { getTrustedAvatarUrl } from "@/lib/auth/avatar";
import { requirePageActor } from "@/lib/auth/page";
import { appRoleSchema } from "@/lib/auth/roles";
import { getOptionalServerMetadata } from "@/lib/env/server";
import AdminTokenInventory from "./AdminTokenInventory";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const searchSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

const profileRowSchema = z.strictObject({
  id: z.uuid(),
  email: z.email(),
  role: appRoleSchema,
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  created_at: z.string(),
  is_active: z.literal(true),
});

type SearchParameters = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function pageHref(page: number): string {
  return page > 1 ? `/dashboard/admin?page=${page}` : "/dashboard/admin";
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParameters>;
}) {
  const actor = await requirePageActor();
  if (actor.role !== "administrator") redirect("/dashboard");
  const extensionEnabled = getOptionalServerMetadata().EXTENSION_ENABLED;

  const parameters = await searchParams;
  const { page } = searchSchema.parse({ page: firstValue(parameters.page) || "1" });
  const start = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await actor.supabase
    .from("profiles")
    .select("id, email, role, display_name, avatar_url, created_at, is_active", { count: "exact" })
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(start, start + PAGE_SIZE - 1);

  if (error) throw new Error("Unable to load user profiles.");

  const rows = z.array(profileRowSchema).parse(data ?? []);
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > pageCount) redirect(pageHref(pageCount));

  const users: AdminUserProfile[] = rows.map((profile) => ({
    id: profile.id,
    email: profile.email,
    role: profile.role,
    displayName: profile.display_name,
    createdAt: profile.created_at,
    avatarUrl: getTrustedAvatarUrl(profile.avatar_url),
  }));

  return (
    <div className="space-y-6">
      <header className="mt-4">
        <h1 className="text-[32px] font-extrabold leading-tight tracking-tight text-[#1B254B]">
          Members &amp; access
        </h1>
        <p className="mt-1 text-[15px] font-medium text-[#718096]">
          View members and assign their Curio roles.
        </p>
      </header>

      {total === 1 ? (
        <aside
          aria-label="Member access information"
          className="flex items-start gap-3 rounded-2xl border border-[#B9DCF4] bg-[#EAF6FF] px-5 py-4 text-sm text-[#1B254B]"
        >
          <UserRoundPlus
            aria-hidden="true"
            size={20}
            strokeWidth={2.25}
            className="mt-0.5 shrink-0 text-[#005C9E]"
          />
          <p className="font-medium leading-6">
            <span className="font-bold">Only you have joined this Curio instance.</span> Allowed
            members appear here after their first sign-in.
          </p>
        </aside>
      ) : null}

      <AdminTable key={page} initialUsers={users} currentUserId={actor.user.id} />

      {extensionEnabled ? (
        <details className="overflow-hidden rounded-[24px] border border-border bg-white shadow-soft">
          <summary className="cursor-pointer px-5 py-4 text-sm font-extrabold text-[#47548C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-6">
            Advanced
            <span className="ml-2 font-medium text-[#718096]">Browser extension access</span>
          </summary>
          <div className="border-t border-border">
            <AdminTokenInventory embedded />
          </div>
        </details>
      ) : null}

      {pageCount > 1 ? (
        <nav aria-label="Member pagination" className="flex items-center justify-center gap-3">
          {page > 1 ? (
            <Link
              href={pageHref(page - 1)}
              className="rounded-xl border border-border bg-white px-4 py-2 text-sm font-bold text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Previous
            </Link>
          ) : null}
          <span className="text-sm font-medium text-[#718096]">
            Page {page} of {pageCount} · {total} members
          </span>
          {page < pageCount ? (
            <Link
              href={pageHref(page + 1)}
              className="rounded-xl border border-border bg-white px-4 py-2 text-sm font-bold text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
