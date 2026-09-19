"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, Clipboard, ExternalLink, KeyRound, Loader2, ShieldX, Trash2 } from "lucide-react";
import { z } from "zod";

import { fetchWithTimeout } from "@/lib/http/fetch-with-timeout";

const tokenScopeSchema = z.enum(["entries:write", "tags:read", "profile:read"]);
type TokenScope = z.infer<typeof tokenScopeSchema>;

const tokenRecordSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  token_prefix: z.string(),
  scopes: z.array(tokenScopeSchema),
  expires_at: z.string().nullable(),
  last_used_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});
type TokenRecord = z.infer<typeof tokenRecordSchema>;

const apiErrorSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

const listSuccessSchema = z.strictObject({
  data: z.strictObject({ tokens: z.array(tokenRecordSchema) }),
  error: z.null(),
});

const createSuccessSchema = z.strictObject({
  data: z.strictObject({
    token: z.string().min(1),
    apiToken: z.unknown(),
  }),
  error: z.null(),
});

const revokeSuccessSchema = z.strictObject({
  data: z.strictObject({ token: z.unknown() }),
  error: z.null(),
});

const errorEnvelopeSchema = z.strictObject({
  data: z.null(),
  error: apiErrorSchema,
});

const DEFAULT_DEVICE_NAME = "Chrome on this device";

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("The server returned an unreadable response.");
  }
}

function responseError(payload: unknown, fallback: string): string {
  const parsed = errorEnvelopeSchema.safeParse(payload);
  return parsed.success ? parsed.data.error.message : fallback;
}

async function requestTokens(signal?: AbortSignal): Promise<TokenRecord[]> {
  const response = await fetchWithTimeout("/api/v1/tokens", {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  const payload = await responsePayload(response);
  const parsed = listSuccessSchema.safeParse(payload);
  if (!response.ok || !parsed.success) {
    throw new Error(responseError(payload, "API tokens could not be loaded."));
  }
  return parsed.data.data.tokens;
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function tokenState(token: TokenRecord): "Active" | "Expired" | "Revoked" {
  if (token.revoked_at) return "Revoked";
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) {
    return "Expired";
  }
  return "Active";
}

export default function PersonalAccessTokens({
  allowedScopes,
  installUrl,
}: {
  allowedScopes: TokenScope[];
  installUrl?: string | null;
}) {
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [name, setName] = useState(DEFAULT_DEVICE_NAME);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [revokeCandidateId, setRevokeCandidateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void requestTokens(controller.signal)
      .then((records) => setTokens(records))
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : "API tokens could not be loaded.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, []);

  const reloadTokens = async () => {
    const records = await requestTokens();
    setTokens(records);
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatus(null);
    setCopyStatus(null);
    setIsMutating(true);
    try {
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000).toISOString();
      const response = await fetchWithTimeout("/api/v1/tokens", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          scopes: allowedScopes,
          expiresAt,
        }),
      });
      const payload = await responsePayload(response);
      const parsed = createSuccessSchema.safeParse(payload);
      if (response.status !== 201 || !parsed.success) {
        throw new Error(responseError(payload, "The API token could not be created."));
      }

      setCreatedToken(parsed.data.data.token);
      setName(DEFAULT_DEVICE_NAME);
      await reloadTokens();
    } catch (createError: unknown) {
      setError(
        createError instanceof Error ? createError.message : "The API token could not be created.",
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleCopy = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopyStatus("Copied to clipboard.");
    } catch {
      setCopyStatus("Copy failed. Select the token and copy it manually.");
    }
  };

  const handleRevoke = async (id: string) => {
    setIsMutating(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetchWithTimeout(`/api/v1/tokens/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const payload = await responsePayload(response);
      const parsed = revokeSuccessSchema.safeParse(payload);
      if (!response.ok || !parsed.success) {
        throw new Error(responseError(payload, "The API token could not be revoked."));
      }
      setRevokeCandidateId(null);
      setStatus("Browser connection revoked.");
      await reloadTokens();
    } catch (revokeError: unknown) {
      setError(
        revokeError instanceof Error ? revokeError.message : "The API token could not be revoked.",
      );
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <section aria-labelledby="api-token-heading" className="space-y-5">
      <header>
        <h2 id="api-token-heading" className="text-xl font-extrabold text-[#1B254B]">
          Connect the Chrome extension
        </h2>
        <p className="mt-1 text-sm font-medium leading-relaxed text-[#718096]">
          Install Curio, create a one-time connection key, then paste it into the extension
          settings. The key expires after one year and can be revoked here at any time.
        </p>
        {installUrl ? (
          <a
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#EAF5FF] px-4 py-2.5 text-sm font-extrabold text-primary hover:bg-[#DCEEFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Add to Chrome <ExternalLink aria-hidden="true" size={16} />
          </a>
        ) : (
          <p className="mt-4 rounded-xl bg-[#F4F7FE] px-4 py-3 text-xs font-bold text-[#47548C]">
            The Store link will appear here after the Curio extension update is published.
          </p>
        )}
      </header>

      {createdToken ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h3 className="font-extrabold text-amber-950">Copy this connection key now</h3>
          <p className="mt-1 text-sm font-medium text-amber-900">
            Curio will not show it again. Open the extension settings, paste the key, then verify
            the connection.
          </p>
          <label className="mt-4 block text-xs font-bold text-amber-950">
            New extension connection key
            <textarea
              readOnly
              value={createdToken}
              rows={3}
              spellCheck={false}
              className="mt-2 w-full resize-none rounded-xl border border-amber-300 bg-white p-3 font-mono text-xs text-slate-900 outline-none focus:ring-2 focus:ring-amber-600"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-900 px-4 py-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-900 focus-visible:ring-offset-2"
            >
              <Clipboard aria-hidden="true" size={15} /> Copy key
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatedToken(null);
                setCopyStatus(null);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-bold text-amber-950 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-900"
            >
              <Check aria-hidden="true" size={15} /> I have stored it
            </button>
          </div>
          {copyStatus ? (
            <p role="status" className="mt-2 text-xs font-bold text-amber-950">
              {copyStatus}
            </p>
          ) : null}
        </div>
      ) : null}

      <form
        onSubmit={handleCreate}
        className="rounded-[24px] border border-border bg-white p-5 shadow-soft sm:p-6"
      >
        <h3 className="font-extrabold text-[#1B254B]">Create a connection key</h3>
        <p className="mt-1 text-xs font-medium leading-relaxed text-[#718096]">
          This key can submit links and read the tags needed by the extension. It cannot manage
          members or change Curio settings.
        </p>
        <div className="mt-4">
          <label className="text-sm font-bold text-[#1B254B]">
            Device name
            <input
              type="text"
              required
              minLength={1}
              maxLength={80}
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={DEFAULT_DEVICE_NAME}
              className="mt-2 w-full rounded-xl border border-border bg-[#F4F7FE] px-4 py-3 font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={isMutating}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isMutating ? (
            <Loader2 aria-hidden="true" className="animate-spin" size={17} />
          ) : (
            <KeyRound aria-hidden="true" size={17} />
          )}
          Create connection key
        </button>
      </form>

      <div aria-live="polite" aria-atomic="true">
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700"
          >
            {error}
          </p>
        ) : null}
        {status ? (
          <p
            role="status"
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700"
          >
            {status}
          </p>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-[24px] border border-border bg-white shadow-soft">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <h3 className="font-extrabold text-[#1B254B]">Connected browsers</h3>
        </div>
        {isLoading ? (
          <p
            role="status"
            className="flex items-center gap-2 px-6 py-8 text-sm font-medium text-[#718096]"
          >
            <Loader2 aria-hidden="true" className="animate-spin" size={17} /> Loading tokens…
          </p>
        ) : tokens.length === 0 ? (
          <p className="px-6 py-8 text-sm font-medium text-[#718096]">
            No browser connections yet.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {tokens.map((token) => {
              const state = tokenState(token);
              const isConfirming = revokeCandidateId === token.id;
              return (
                <li key={token.id} className="p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold text-[#1B254B]">{token.name}</span>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${state === "Active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}
                        >
                          {state}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-xs text-[#718096]">
                        Prefix: {token.token_prefix}
                      </p>
                      <p className="mt-2 text-xs font-medium text-[#718096]">
                        Created {formatDate(token.created_at)} · Last used{" "}
                        {formatDate(token.last_used_at)}
                        {token.expires_at
                          ? ` · Expires ${formatDate(token.expires_at)}`
                          : " · No expiry"}
                      </p>
                    </div>
                    {state === "Active" ? (
                      isConfirming ? (
                        <div
                          className="flex shrink-0 flex-wrap items-center gap-2"
                          role="group"
                          aria-label={`Confirm revocation of ${token.name}`}
                        >
                          <button
                            type="button"
                            onClick={() => handleRevoke(token.id)}
                            disabled={isMutating}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-60"
                          >
                            <ShieldX aria-hidden="true" size={15} /> Confirm revoke
                          </button>
                          <button
                            type="button"
                            onClick={() => setRevokeCandidateId(null)}
                            className="rounded-lg bg-[#E9EDF7] px-3 py-2 text-xs font-bold text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRevokeCandidateId(token.id)}
                          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                        >
                          <Trash2 aria-hidden="true" size={15} /> Revoke
                        </button>
                      )
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
