import Image from "next/image";
import Link from "next/link";
import { Puzzle } from "lucide-react";
import AuthorAvatar, { getAuthorDetails } from "./AuthorAvatar";
import SidebarNav, { type SidebarNavItem } from "./SidebarNav";
import type { UserRole } from "./types";

export type SidebarUser = {
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
};

type SidebarProps = {
  user?: SidebarUser | null;
  role?: UserRole;
  extensionUrl?: string | null;
};

const roleLabels: Record<UserRole, string> = {
  reader: "Reader",
  contributor: "Contributor",
  administrator: "Administrator",
};

export default function Sidebar({
  user = null,
  role = "reader",
  extensionUrl = null,
}: SidebarProps) {
  const navItems: SidebarNavItem[] = [
    { name: "Dashboard", href: "/dashboard", iconName: "LayoutDashboard" },
    { name: "Tags & Topics", href: "/dashboard/tags", iconName: "Tag" },
  ];

  if (role === "administrator") {
    navItems.push({
      name: "Members",
      href: "/dashboard/admin",
      iconName: "UsersRound",
    });
  }

  const displayName = user
    ? user.displayName?.trim() || getAuthorDetails(user.email).displayName
    : "Guest";

  return (
    <aside className="z-20 flex h-full w-[76px] shrink-0 flex-col border-r border-border bg-card shadow-md lg:w-[250px]">
      <div className="flex h-[88px] items-center border-b border-border/40 bg-card">
        <Link
          href="/dashboard"
          prefetch
          aria-label="Curio dashboard"
          className="flex h-full w-full items-center justify-center px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary lg:justify-start lg:px-8"
        >
          <Image
            src="/curio-logo.svg"
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 object-contain lg:hidden"
          />
          <Image
            src="/curio-logo-horizontal-3.svg"
            alt="Curio"
            width={2315}
            height={544}
            className="hidden h-auto w-[110px] object-contain lg:block"
          />
        </Link>
      </div>

      <SidebarNav navItems={navItems} />

      {extensionUrl ? (
        <div className="mb-2 px-3">
          <a
            href={extensionUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Add the Curio browser extension"
            className="flex w-full items-center justify-center gap-3 rounded-2xl px-3 py-3 text-[14px] font-bold text-[#718096] transition-colors hover:bg-[#F4F7FE] hover:text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:justify-start lg:px-4"
          >
            <span className="flex w-[34px] shrink-0 items-center justify-center">
              <Puzzle aria-hidden="true" size={20} strokeWidth={2.5} />
            </span>
            <span className="hidden lg:inline">Add to Chrome</span>
          </a>
        </div>
      ) : null}

      <div className="px-3 pb-5">
        <Link
          href="/dashboard/settings"
          prefetch
          aria-label={`Account settings. Signed in as ${displayName}, ${roleLabels[role]}.`}
          className="flex w-full items-center justify-center gap-3 rounded-2xl px-2 py-3 text-[#718096] transition-colors hover:bg-[#F4F7FE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:justify-start lg:px-4"
        >
          <AuthorAvatar email={user?.email ?? ""} src={user?.avatarUrl} size={34} />
          <span className="hidden min-w-0 flex-col overflow-hidden leading-tight lg:flex">
            <span className="truncate text-sm font-bold text-[#1B254B]">{displayName}</span>
            <span className="text-[11px] font-medium text-[#718096]">{roleLabels[role]}</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}
