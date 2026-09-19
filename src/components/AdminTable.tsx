"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import AuthorAvatar from "./AuthorAvatar";
import { getRequestErrorMessage, readApiEnvelope } from "./api-envelope";
import CustomSelect, { type SelectOption } from "./CustomSelect";
import RoleBadge, { RoleIcon, roleBadgeClasses, roleLabels } from "./RoleBadge";
import { isUserRole, type UserRole } from "./types";

export type AdminUserProfile = {
  id: string;
  email: string;
  displayName?: string | null;
  role: UserRole;
  createdAt: string;
  avatarUrl?: string | null;
};

type AdminTableProps = {
  initialUsers: AdminUserProfile[];
  currentUserId?: string;
};

const roleOptions: SelectOption[] = [
  { label: roleLabels.reader, value: "reader", icon: <RoleIcon role="reader" /> },
  {
    label: roleLabels.contributor,
    value: "contributor",
    icon: <RoleIcon role="contributor" />,
  },
  {
    label: roleLabels.administrator,
    value: "administrator",
    icon: <RoleIcon role="administrator" />,
  },
];

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

export default function AdminTable({ initialUsers, currentUserId }: AdminTableProps) {
  const [users, setUsers] = useState(initialUsers);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleRoleChange = async (userId: string, roleValue: string) => {
    if (!isUserRole(roleValue)) {
      setFeedback("The selected role is invalid.");
      return;
    }
    const role = roleValue;
    const previousRole = users.find((user) => user.id === userId)?.role;
    if (!previousRole || previousRole === role) return;

    setUpdatingId(userId);
    setFeedback(null);
    try {
      const response = await fetch(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role }),
      });
      const envelope = await readApiEnvelope<Record<string, unknown>>(response);
      if (!response.ok || envelope.error || !envelope.data) {
        throw new Error(
          getRequestErrorMessage(response, envelope.error, "The role could not be updated."),
        );
      }

      setUsers((currentUsers) =>
        currentUsers.map((user) => (user.id === userId ? { ...user, role } : user)),
      );
      setFeedback(`Role updated to ${roleLabels[role]}.`);
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : "The role could not be updated.");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <section
      aria-labelledby="user-administration-heading"
      className="overflow-hidden rounded-[24px] border border-border bg-white shadow-soft"
    >
      <h2 id="user-administration-heading" className="sr-only">
        Member roles
      </h2>
      {feedback ? (
        <div
          role="status"
          className="border-b border-border bg-[#F4F7FE] px-5 py-3 text-sm font-medium text-[#47548C]"
        >
          {feedback}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left">
          <caption className="sr-only">Members and their Curio access roles</caption>
          <thead>
            <tr className="bg-[#F4F7FE] text-xs font-extrabold uppercase tracking-wider text-[#718096]">
              <th scope="col" className="border-b border-border/70 px-6 py-4">
                User
              </th>
              <th scope="col" className="border-b border-border/70 px-6 py-4">
                Joined
              </th>
              <th scope="col" className="border-b border-border/70 px-6 py-4">
                Role
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50 text-sm font-medium text-[#1B254B]">
            {users.map((user) => {
              const isUpdating = updatingId === user.id;
              const isCurrentUser = currentUserId === user.id;
              return (
                <tr key={user.id} className="transition-colors hover:bg-[#F4F7FE]/50">
                  <th scope="row" className="px-6 py-4 font-medium">
                    <span className="flex items-center gap-3">
                      <AuthorAvatar
                        email={user.email}
                        displayName={user.displayName}
                        src={user.avatarUrl}
                        size={32}
                      />
                      <span className="min-w-0 max-w-[280px]">
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <span className="truncate font-bold">
                            {user.displayName?.trim() || user.email}
                          </span>
                          {isCurrentUser ? (
                            <span className="shrink-0 text-[11px] font-medium text-[#718096]">
                              (you)
                            </span>
                          ) : null}
                        </span>
                        {user.displayName?.trim() ? (
                          <span className="mt-0.5 block truncate text-xs font-medium text-[#718096]">
                            {user.email}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </th>
                  <td className="px-6 py-4 text-[#718096]">{formatDate(user.createdAt)}</td>
                  <td className="px-6 py-4">
                    {isCurrentUser ? (
                      <RoleBadge role={user.role} />
                    ) : (
                      <span className="flex items-center gap-2">
                        <CustomSelect
                          value={user.role}
                          onChange={(newRole) => handleRoleChange(user.id, newRole)}
                          ariaLabel={`Role for ${user.email}`}
                          options={roleOptions}
                          disabled={isUpdating}
                          className="w-[190px]"
                          triggerClassName={`h-[38px] rounded-full px-3 py-1 text-xs ${roleBadgeClasses[user.role]}`}
                        />
                        {isUpdating ? (
                          <Loader2
                            aria-label="Updating role"
                            className="animate-spin text-primary"
                            size={18}
                          />
                        ) : null}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-6 py-12 text-center text-[#718096]">
                  No members found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
