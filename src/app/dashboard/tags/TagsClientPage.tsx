"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { Check, Edit2, Hash, Loader2, Plus, Trash2, TrendingUp, X } from "lucide-react";

import type { AppRole } from "@/lib/auth/roles";
import { catalogCardStyles } from "@/lib/ui/catalog-card-styles";
import { getTintedTagStyle } from "@/lib/ui/tag-colors";

import { createTagAction, deleteTagAction, updateTagAction } from "./actions";

export type TaxonomyTag = {
  id: string;
  name: string;
  slug: string;
  color: string;
  usageCount: number;
};

type TagDraft = {
  name: string;
  slug: string;
  color: string;
};

type Feedback = {
  tone: "success" | "error";
  message: string;
};

const COLOR_PALETTE = [
  "#0075C9",
  "#8B5CF6",
  "#F59E0B",
  "#10B981",
  "#EC4899",
  "#6366F1",
  "#14B8A6",
  "#F97316",
  "#EF4444",
  "#84CC16",
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The tags could not be updated.";
}

function TagBadge({ tag }: { tag: Pick<TaxonomyTag, "name" | "color"> }) {
  return (
    <span
      className={`inline-flex w-max items-center ${catalogCardStyles.tag}`}
      style={getTintedTagStyle(tag.color)}
    >
      {tag.name}
    </span>
  );
}

export default function TagsClientPage({
  initialTags,
  role,
}: {
  initialTags: TaxonomyTag[];
  role: AppRole;
}) {
  const [tags, setTags] = useState(initialTags);
  const [newTagName, setNewTagName] = useState("");
  const [isManageMode, setIsManageMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TagDraft | null>(null);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isPending, startTransition] = useTransition();
  const mutationPendingRef = useRef(false);
  const canManage = role === "administrator";

  const mostPopularTag = tags.reduce<TaxonomyTag | null>(
    (mostPopular, tag) =>
      !mostPopular || tag.usageCount > mostPopular.usageCount ? tag : mostPopular,
    null,
  );

  const beginEdit = (tag: TaxonomyTag) => {
    setDeleteCandidateId(null);
    setEditingId(tag.id);
    setEditDraft({ name: tag.name, slug: tag.slug, color: tag.color });
    setFeedback(null);
  };

  const leaveManageMode = () => {
    setIsManageMode(false);
    setEditingId(null);
    setEditDraft(null);
    setDeleteCandidateId(null);
  };

  const startMutation = (mutation: () => Promise<void>) => {
    if (mutationPendingRef.current) return;
    mutationPendingRef.current = true;
    startTransition(async () => {
      try {
        await mutation();
      } finally {
        mutationPendingRef.current = false;
      }
    });
  };

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    startMutation(async () => {
      try {
        const result = await createTagAction({ name: newTagName });
        if (!result.ok) {
          setFeedback({ tone: "error", message: result.message });
          return;
        }
        if (!("tag" in result)) return;
        setTags((current) => [{ ...result.tag, usageCount: 0 }, ...current]);
        setNewTagName("");
        setFeedback({ tone: "success", message: `${result.tag.name} was added.` });
      } catch (error: unknown) {
        setFeedback({ tone: "error", message: errorMessage(error) });
      }
    });
  };

  const handleUpdate = (event: FormEvent<HTMLFormElement>, id: string) => {
    event.preventDefault();
    if (!editDraft) return;
    setFeedback(null);
    startMutation(async () => {
      try {
        const result = await updateTagAction({ id, ...editDraft });
        if (!result.ok) {
          setFeedback({ tone: "error", message: result.message });
          return;
        }
        if (!("tag" in result)) return;
        setTags((current) =>
          current.map((tag) =>
            tag.id === id ? { ...result.tag, usageCount: tag.usageCount } : tag,
          ),
        );
        setEditingId(null);
        setEditDraft(null);
        setFeedback({ tone: "success", message: `${result.tag.name} was updated.` });
      } catch (error: unknown) {
        setFeedback({ tone: "error", message: errorMessage(error) });
      }
    });
  };

  const handleDelete = (id: string) => {
    setFeedback(null);
    startMutation(async () => {
      try {
        const result = await deleteTagAction({ id });
        if (!result.ok) {
          setFeedback({ tone: "error", message: result.message });
          return;
        }
        setTags((current) => current.filter((tag) => tag.id !== id));
        setDeleteCandidateId(null);
        setFeedback({ tone: "success", message: "Tag deleted." });
      } catch (error: unknown) {
        setFeedback({ tone: "error", message: errorMessage(error) });
      }
    });
  };

  return (
    <div className="space-y-6">
      <header className="mt-4">
        <h1 className="text-[32px] font-extrabold leading-tight tracking-tight text-[#1B254B]">
          Tags &amp; Topics
        </h1>
        <p className="mt-1 text-[15px] font-medium text-[#718096]">
          Organize the topics people can use across Curio.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="flex items-center justify-between rounded-2xl border border-border bg-white p-5 shadow-soft">
          <div>
            <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-[#718096]">
              <Hash aria-hidden="true" size={15} /> Total Tags
            </p>
            <p className="mt-2 text-3xl font-extrabold text-[#1B254B]">{tags.length}</p>
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-white p-5 shadow-soft">
          <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-[#718096]">
            <TrendingUp aria-hidden="true" size={15} /> Most Popular
          </p>
          {mostPopularTag ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <TagBadge tag={mostPopularTag} />
              <span className="text-sm font-bold text-emerald-700">
                Used {mostPopularTag.usageCount} time
                {mostPopularTag.usageCount === 1 ? "" : "s"}
              </span>
            </div>
          ) : (
            <p className="mt-2 text-sm font-medium text-[#718096]">No tags yet</p>
          )}
        </section>
      </div>

      {feedback ? (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          className={`rounded-xl border px-4 py-3 text-sm font-bold ${
            feedback.tone === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {feedback.message}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-[24px] border border-border bg-white shadow-soft">
        <header className="flex flex-col gap-4 border-b border-border/70 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="text-lg font-extrabold text-[#1B254B]">All Tags</h2>
            {!canManage ? (
              <p className="mt-1 text-xs font-medium text-[#718096]">
                Administrators manage the shared tag list.
              </p>
            ) : null}
          </div>

          {canManage ? (
            isManageMode ? (
              <button
                type="button"
                onClick={leaveManageMode}
                disabled={isPending}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#E9EDF7] px-4 text-sm font-bold text-[#1B254B] hover:bg-[#DDE4F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check aria-hidden="true" size={16} /> Done
              </button>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <form onSubmit={handleCreate} className="flex min-w-0">
                  <label htmlFor="quick-add-tag" className="sr-only">
                    Tag name
                  </label>
                  <input
                    id="quick-add-tag"
                    type="text"
                    required
                    maxLength={60}
                    disabled={isPending}
                    value={newTagName}
                    onChange={(event) => setNewTagName(event.target.value)}
                    placeholder="Add a tag…"
                    className="min-w-0 flex-1 rounded-l-xl border border-r-0 border-border bg-[#F4F7FE] px-4 py-2.5 text-sm font-medium text-[#1B254B] outline-none placeholder:text-[#A3AED0] focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/10"
                  />
                  <button
                    type="submit"
                    disabled={isPending || !newTagName.trim()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-r-xl bg-primary px-4 text-sm font-bold text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isPending ? (
                      <Loader2 aria-hidden="true" className="animate-spin" size={16} />
                    ) : (
                      <Plus aria-hidden="true" size={16} />
                    )}
                    Add
                  </button>
                </form>
                <button
                  type="button"
                  onClick={() => setIsManageMode(true)}
                  disabled={isPending}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 text-sm font-bold text-[#47548C] hover:border-primary/30 hover:text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Edit2 aria-hidden="true" size={16} /> Manage
                </button>
              </div>
            )
          ) : null}
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left">
            <caption className="sr-only">Tags and how often they are used</caption>
            <thead className="text-xs font-extrabold uppercase tracking-wider text-[#718096]">
              <tr>
                <th scope="col" className="px-6 py-4">
                  Display Name
                </th>
                <th scope="col" className="px-6 py-4 text-center">
                  Usage Count
                </th>
                {isManageMode ? (
                  <th scope="col" className="px-6 py-4 text-right">
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {tags.map((tag) => {
                const isEditing = editingId === tag.id && editDraft;
                const isConfirmingDelete = deleteCandidateId === tag.id;

                if (isEditing) {
                  return (
                    <tr key={tag.id} className="bg-[#F8FAFC] align-top">
                      <td colSpan={3} className="px-6 py-5">
                        <form
                          onSubmit={(event) => handleUpdate(event, tag.id)}
                          className="space-y-4"
                        >
                          <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_auto] lg:items-start">
                            <label className="text-xs font-bold text-[#1B254B]">
                              Display Name
                              <input
                                type="text"
                                required
                                maxLength={60}
                                disabled={isPending}
                                value={editDraft.name}
                                onChange={(event) =>
                                  setEditDraft((draft) =>
                                    draft ? { ...draft, name: event.target.value } : draft,
                                  )
                                }
                                className="mt-1.5 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                              />
                            </label>
                            <fieldset>
                              <legend className="text-xs font-bold text-[#1B254B]">Colour</legend>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {COLOR_PALETTE.map((color) => (
                                  <button
                                    key={color}
                                    type="button"
                                    disabled={isPending}
                                    aria-label={`Use colour ${color}`}
                                    aria-pressed={
                                      editDraft.color.toLowerCase() === color.toLowerCase()
                                    }
                                    onClick={() =>
                                      setEditDraft((draft) => (draft ? { ...draft, color } : draft))
                                    }
                                    className="h-7 w-7 rounded-full border-2 border-white shadow-sm outline-none ring-1 ring-slate-200 focus-visible:ring-2 focus-visible:ring-primary aria-pressed:ring-2 aria-pressed:ring-[#1B254B]"
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                              </div>
                            </fieldset>
                          </div>

                          <details className="rounded-xl border border-border bg-white px-4 py-3 text-sm">
                            <summary className="cursor-pointer font-bold text-[#47548C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                              Advanced
                            </summary>
                            <label className="mt-3 block text-xs font-bold text-[#1B254B]">
                              Slug
                              <input
                                type="text"
                                required
                                maxLength={60}
                                disabled={isPending}
                                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                                title="Lowercase letters, numbers, and single hyphens"
                                value={editDraft.slug}
                                onChange={(event) =>
                                  setEditDraft((draft) =>
                                    draft
                                      ? { ...draft, slug: event.target.value.toLowerCase() }
                                      : draft,
                                  )
                                }
                                className="mt-1.5 w-full max-w-md rounded-xl border border-border bg-[#F4F7FE] px-3 py-2.5 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                              />
                              <span className="mt-1.5 block font-medium text-[#718096]">
                                Curio generates this identifier automatically. Change it only when
                                an integration requires a specific value.
                              </span>
                            </label>
                          </details>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="submit"
                              disabled={isPending}
                              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                            >
                              {isPending ? (
                                <Loader2 aria-hidden="true" className="animate-spin" size={16} />
                              ) : (
                                <Check aria-hidden="true" size={16} />
                              )}
                              Save
                            </button>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => {
                                setEditingId(null);
                                setEditDraft(null);
                              }}
                              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#E9EDF7] px-4 text-sm font-bold text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <X aria-hidden="true" size={16} /> Cancel
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={tag.id} className="transition-colors hover:bg-[#F4F7FE]/40">
                    <th scope="row" className="px-6 py-4 font-medium">
                      <TagBadge tag={tag} />
                    </th>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex min-w-9 justify-center rounded-lg bg-[#F4F7FE] px-2.5 py-1.5 text-xs font-bold text-[#1B254B]">
                        {tag.usageCount}
                      </span>
                    </td>
                    {isManageMode ? (
                      <td className="px-6 py-4 text-right">
                        {isConfirmingDelete ? (
                          <div
                            className="inline-flex flex-wrap items-center justify-end gap-2"
                            role="group"
                            aria-label={`Confirm deletion of ${tag.name}`}
                          >
                            <span className="text-xs font-medium text-red-700">
                              Delete this unused tag?
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDelete(tag.id)}
                              disabled={isPending}
                              className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-60"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteCandidateId(null)}
                              disabled={isPending}
                              className="rounded-lg bg-[#E9EDF7] px-3 py-2 text-xs font-bold text-[#1B254B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex gap-2">
                            <button
                              type="button"
                              onClick={() => beginEdit(tag)}
                              disabled={isPending}
                              aria-label={`Edit ${tag.name}`}
                              className="rounded-lg bg-[#F4F7FE] p-2 text-[#47548C] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Edit2 aria-hidden="true" size={16} />
                            </button>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => {
                                setEditingId(null);
                                setEditDraft(null);
                                setDeleteCandidateId(tag.id);
                              }}
                              aria-label={`Delete ${tag.name}`}
                              className="rounded-lg bg-red-50 p-2 text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 aria-hidden="true" size={16} />
                            </button>
                          </div>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {tags.length === 0 ? (
                <tr>
                  <td
                    colSpan={isManageMode ? 3 : 2}
                    className="px-6 py-12 text-center text-sm font-medium text-[#718096]"
                  >
                    No tags yet. Add the first one above.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
