import { z } from "zod";

import { requirePageActor } from "@/lib/auth/page";

import TagsClientPage, { type TaxonomyTag } from "./TagsClientPage";

export const dynamic = "force-dynamic";

const tagRowSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  color: z.string(),
  entry_tags: z.array(z.strictObject({ count: z.number().int().nonnegative() })),
});

export default async function TagsPage() {
  const actor = await requirePageActor();
  const { data, error } = await actor.supabase
    .from("tags")
    .select("id, name, slug, color, entry_tags(count)")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw new Error("Unable to load the organization taxonomy.");

  const rows = z.array(tagRowSchema).parse(data ?? []);
  const tags: TaxonomyTag[] = rows.map((tag) => ({
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    color: tag.color,
    usageCount: tag.entry_tags[0]?.count ?? 0,
  }));

  return <TagsClientPage initialTags={tags} role={actor.role} />;
}
