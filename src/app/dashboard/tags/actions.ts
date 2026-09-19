"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requirePageActor } from "@/lib/auth/page";
import { createServiceRoleClient } from "@/lib/supabase/server";

const tagNameSchema = z.string().trim().min(1).max(60);
const tagSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens.");
const tagColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Choose a valid six-digit colour.");

const createTagSchema = z.strictObject({
  name: tagNameSchema,
});

const updateTagSchema = z.strictObject({
  id: z.uuid(),
  name: tagNameSchema,
  slug: tagSlugSchema,
  color: tagColorSchema,
});

const deleteTagSchema = z.strictObject({ id: z.uuid() });

// RPCs return the complete table row; this action exposes only the public tag fields.
const tagResultSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  color: z.string(),
});

type TagResult = z.infer<typeof tagResultSchema>;
type TagActionResult =
  { ok: true; tag: TagResult } | { ok: true; deletedId: string } | { ok: false; message: string };

function validationMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "The tag details are invalid.";
}

const automaticTagColors = [
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

function slugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60)
    .replace(/-+$/gu, "");
}

function colorFromSlug(slug: string): string {
  let hash = 0;
  for (const character of slug) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return automaticTagColors[hash % automaticTagColors.length]!;
}

function mutationErrorMessage(code: string | undefined, message = ""): string {
  if (message.includes("TAG_NOT_FOUND")) return "Tag not found.";
  if (message.includes("TAG_IN_USE")) {
    return "This tag is still referenced and cannot be deleted.";
  }
  if (code === "23505") return "A tag with this name or slug already exists.";
  if (code === "23503") {
    return "This tag is still referenced and cannot be deleted.";
  }
  return "The taxonomy could not be updated. Please try again.";
}

async function administratorActor() {
  const actor = await requirePageActor();
  return actor.role === "administrator" ? actor : null;
}

function refreshTaxonomy() {
  revalidatePath("/dashboard/tags");
  revalidatePath("/dashboard");
}

export async function createTagAction(input: unknown): Promise<TagActionResult> {
  const actor = await administratorActor();
  if (!actor) {
    return { ok: false, message: "Administrator permission is required." };
  }

  const parsed = createTagSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: validationMessage(parsed.error) };
  }

  const slug = slugFromName(parsed.data.name);
  if (!slug) {
    return {
      ok: false,
      message: "Use a tag name containing at least one letter or number.",
    };
  }

  const service = createServiceRoleClient();
  const { data, error } = await service
    .rpc("create_tag", {
      p_actor_user_id: actor.user.id,
      p_name: parsed.data.name,
      p_slug: slug,
      p_color: colorFromSlug(slug),
    })
    .single();
  if (error) {
    return { ok: false, message: mutationErrorMessage(error.code, error.message) };
  }

  const tag = tagResultSchema.safeParse(data);
  if (!tag.success) {
    return { ok: false, message: "The created tag could not be verified." };
  }

  refreshTaxonomy();
  return { ok: true, tag: tag.data };
}

export async function updateTagAction(input: unknown): Promise<TagActionResult> {
  const actor = await administratorActor();
  if (!actor) {
    return { ok: false, message: "Administrator permission is required." };
  }

  const parsed = updateTagSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: validationMessage(parsed.error) };
  }

  const service = createServiceRoleClient();
  const { data, error } = await service
    .rpc("update_tag", {
      p_actor_user_id: actor.user.id,
      p_tag_id: parsed.data.id,
      p_name: parsed.data.name,
      p_slug: parsed.data.slug,
      p_color: parsed.data.color,
      p_sort_order: null,
    })
    .maybeSingle();
  if (error) {
    return { ok: false, message: mutationErrorMessage(error.code, error.message) };
  }
  if (!data) return { ok: false, message: "Tag not found." };

  const tag = tagResultSchema.safeParse(data);
  if (!tag.success) {
    return { ok: false, message: "The updated tag could not be verified." };
  }

  refreshTaxonomy();
  return { ok: true, tag: tag.data };
}

export async function deleteTagAction(input: unknown): Promise<TagActionResult> {
  const actor = await administratorActor();
  if (!actor) {
    return { ok: false, message: "Administrator permission is required." };
  }

  const parsed = deleteTagSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: validationMessage(parsed.error) };
  }

  const service = createServiceRoleClient();
  const { data, error } = await service.rpc("delete_tag", {
    p_actor_user_id: actor.user.id,
    p_tag_id: parsed.data.id,
  });
  if (error) {
    return { ok: false, message: mutationErrorMessage(error.code, error.message) };
  }
  if (!data) return { ok: false, message: "Tag not found." };

  refreshTaxonomy();
  return { ok: true, deletedId: parsed.data.id };
}
