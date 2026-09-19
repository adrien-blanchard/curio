import { Eye, PencilLine, ShieldCheck, type LucideIcon } from "lucide-react";

import type { UserRole } from "./types";

type RoleBadgeProps = {
  role: UserRole;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
};

type RolePresentation = {
  label: string;
  Icon: LucideIcon;
  className: string;
};

const rolePresentations: Record<UserRole, RolePresentation> = {
  reader: {
    label: "Reader",
    Icon: Eye,
    className: "border-[#CBD5E1] bg-[#F1F5F9] text-[#475569]",
  },
  contributor: {
    label: "Contributor",
    Icon: PencilLine,
    className: "border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]",
  },
  administrator: {
    label: "Administrator",
    Icon: ShieldCheck,
    className: "border-[#99C9EB] bg-[#EAF6FF] text-[#005C9E]",
  },
};

export const roleBadgeClasses: Record<UserRole, string> = {
  reader: rolePresentations.reader.className,
  contributor: rolePresentations.contributor.className,
  administrator: rolePresentations.administrator.className,
};

export const roleLabels: Record<UserRole, string> = {
  reader: rolePresentations.reader.label,
  contributor: rolePresentations.contributor.label,
  administrator: rolePresentations.administrator.label,
};

export function RoleIcon({ role }: { role: UserRole }) {
  const { Icon } = rolePresentations[role];
  return <Icon aria-hidden="true" size={14} strokeWidth={2.25} />;
}

export default function RoleBadge({
  role,
  className = "",
  "aria-hidden": ariaHidden,
}: RoleBadgeProps) {
  const { label } = rolePresentations[role];

  return (
    <span
      aria-hidden={ariaHidden}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold ${roleBadgeClasses[role]} ${className}`}
    >
      <RoleIcon role={role} />
      {label}
    </span>
  );
}
