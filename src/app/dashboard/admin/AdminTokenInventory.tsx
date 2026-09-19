"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Trash2 } from "lucide-react";
import { z } from "zod";

import { apiTokenScopeSchema } from "@/lib/auth/roles";

const tokenSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  token_prefix: z.string(),
  scopes: z.array(apiTokenScopeSchema),
  expires_at: z.string().nullable(),
  last_used_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
  owner_email: z.email().nullable(),
});
const listSchema = z.object({
  data: z.object({
    tokens: z.array(tokenSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  }),
  error: z.null(),
});

type TokenRecord = z.infer<typeof tokenSchema>;

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

function tokenState(token: TokenRecord): "Active" | "Expired" | "Revoked" {
  if (token.revoked_at) return "Revoked";
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) return "Expired";
  return "Active";
}

export default function AdminTokenInventory({ embedded = false }: { embedded?: boolean }) {
  const [page, setPage] = useState(1);
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/v1/tokens?view=organization&page=${page}`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal,
        });
        const parsed = listSchema.safeParse(await response.json());
        if (!response.ok || !parsed.success)
          throw new Error("Organization tokens could not be loaded.");
        setTokens(parsed.data.data.tokens);
        setTotal(parsed.data.data.total);
        setPageSize(parsed.data.data.pageSize);
      } catch (loadError: unknown) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Organization tokens could not be loaded.",
        );
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [page],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const revoke = async (tokenId: string) => {
    setRevokingId(tokenId);
    setError(null);
    try {
      const response = await fetch(`/api/v1/tokens/${encodeURIComponent(tokenId)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("The organization token could not be revoked.");
      setConfirmingId(null);
      await load();
    } catch (revokeError: unknown) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : "The organization token could not be revoked.",
      );
    } finally {
      setRevokingId(null);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section
      className={
        embedded
          ? "overflow-hidden bg-white"
          : "overflow-hidden rounded-[24px] border border-border bg-white shadow-soft"
      }
    >
      <header className="border-b border-border px-5 py-4 sm:px-6">
        <h2 className="flex items-center gap-2 font-extrabold text-[#1B254B]">
          <KeyRound aria-hidden="true" size={18} /> Browser extension access
        </h2>
        <p className="mt-1 text-sm font-medium text-[#718096]">
          Review or revoke browser extension access created by team members.
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-bold text-red-700"
        >
          {error}
        </p>
      ) : null}
      {isLoading ? (
        <p
          role="status"
          className="flex items-center gap-2 px-6 py-8 text-sm font-medium text-[#718096]"
        >
          <Loader2 aria-hidden="true" className="animate-spin" size={17} /> Loading tokens…
        </p>
      ) : tokens.length === 0 ? (
        <p className="px-6 py-8 text-sm font-medium text-[#718096]">No tokens on this page.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <caption className="sr-only">Organization personal access tokens</caption>
            <thead className="bg-[#F4F7FE] text-xs font-extrabold uppercase tracking-wider text-[#718096]">
              <tr>
                <th scope="col" className="px-5 py-3">
                  Owner
                </th>
                <th scope="col" className="px-5 py-3">
                  Token
                </th>
                <th scope="col" className="px-5 py-3">
                  Scopes
                </th>
                <th scope="col" className="px-5 py-3">
                  Last used
                </th>
                <th scope="col" className="px-5 py-3">
                  State
                </th>
                <th scope="col" className="px-5 py-3">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {tokens.map((token) => {
                const state = tokenState(token);
                return (
                  <tr key={token.id}>
                    <td className="px-5 py-4 font-medium text-[#1B254B]">
                      {token.owner_email ?? "Unknown profile"}
                    </td>
                    <td className="px-5 py-4">
                      <span className="block font-bold text-[#1B254B]">{token.name}</span>
                      <span className="font-mono text-xs text-[#718096]">{token.token_prefix}</span>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-[#47548C]">
                      {token.scopes.join(", ")}
                    </td>
                    <td className="px-5 py-4 text-[#718096]">{formatDate(token.last_used_at)}</td>
                    <td className="px-5 py-4 font-bold text-[#47548C]">{state}</td>
                    <td className="px-5 py-4">
                      {state === "Active" ? (
                        confirmingId === token.id ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => revoke(token.id)}
                              disabled={revokingId === token.id}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-60"
                              aria-label={`Confirm revocation of ${token.name}`}
                            >
                              {revokingId === token.id ? (
                                <Loader2 aria-hidden="true" className="animate-spin" size={14} />
                              ) : (
                                <Trash2 aria-hidden="true" size={14} />
                              )}
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(null)}
                              disabled={revokingId === token.id}
                              className="rounded-lg bg-[#E9EDF7] px-3 py-2 text-xs font-bold text-[#1B254B] hover:bg-[#DDE4F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingId(token.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                          >
                            <Trash2 aria-hidden="true" size={14} /> Revoke
                          </button>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <nav
        aria-label="Organization token pagination"
        className="flex items-center justify-center gap-3 border-t border-border px-5 py-4"
      >
        <button
          type="button"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={page <= 1 || isLoading}
          className="rounded-lg bg-[#E9EDF7] px-3 py-2 text-xs font-bold text-[#1B254B] disabled:opacity-50"
        >
          Previous
        </button>
        <span className="text-xs font-medium text-[#718096]">
          Page {page} of {pageCount} · {total} token{total === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
          disabled={page >= pageCount || isLoading}
          className="rounded-lg bg-[#E9EDF7] px-3 py-2 text-xs font-bold text-[#1B254B] disabled:opacity-50"
        >
          Next
        </button>
      </nav>
    </section>
  );
}
