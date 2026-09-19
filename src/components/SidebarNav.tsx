"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Tag, UsersRound } from "lucide-react";

const iconMap = {
  LayoutDashboard,
  Tag,
  UsersRound,
};

export type SidebarNavItem = {
  name: string;
  href: string;
  iconName: keyof typeof iconMap;
};

export default function SidebarNav({ navItems }: { navItems: SidebarNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard" className="flex-1 space-y-2 px-3 py-6 lg:px-4 lg:py-8">
      {navItems.map((item) => {
        const isActive =
          pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
        const Icon = iconMap[item.iconName];

        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch
            aria-current={isActive ? "page" : undefined}
            title={item.name}
            className={`flex w-full items-center justify-center gap-4 rounded-2xl px-3 py-3.5 text-[14px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:justify-start lg:px-4 ${
              isActive
                ? "bg-[#F4F7FE] text-primary shadow-sm"
                : "text-[#718096] hover:bg-[#F4F7FE] hover:text-[#1B254B]"
            }`}
          >
            <Icon aria-hidden="true" size={20} strokeWidth={2.5} />
            <span className="hidden lg:inline">{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
