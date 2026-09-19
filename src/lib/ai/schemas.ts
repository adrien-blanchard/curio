import { z } from "zod";
import { isValidSourceDate, SOURCE_DATE_KINDS } from "@/lib/ui/source-age";

export const analysisResultSchema = z.object({
  title: z.string().trim().min(3).max(100),
  tldr: z.string().trim().min(30).max(800),
  source_published_at: z
    .string()
    .nullable()
    .optional()
    .transform((value) => (value && isValidSourceDate(value) ? value : null)),
  source_date_kind: z.enum(SOURCE_DATE_KINDS).nullable().optional().catch(null),
  suggested_tag_slugs: z
    .array(z.string().trim().min(1).max(64))
    .max(4)
    .transform((values) => [...new Set(values)]),
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;

export type AvailableTag = {
  id: string;
  name: string;
  slug: string;
};

export function createAnalysisJsonSchema(tags: AvailableTag[]) {
  const slugs = tags.map(({ slug }) => slug);
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
        minLength: 3,
        maxLength: 100,
        description: "A concise, factual title for the linked resource.",
      },
      tldr: {
        type: "string",
        minLength: 30,
        maxLength: 800,
        description:
          "A two or three sentence summary of what the resource presents and why it matters.",
      },
      suggested_tag_slugs: {
        type: "array",
        minItems: 0,
        maxItems: Math.min(4, slugs.length),
        items: slugs.length > 0 ? { type: "string", enum: slugs } : { type: "string" },
        description:
          "Zero to four relevant tag slugs from the supplied organization taxonomy. Return an empty array when none apply.",
      },
      source_published_at: {
        type: ["string", "null"],
        description:
          "An explicitly stated source publication, release, video upload or repository creation date in YYYY-MM-DD format. Null when absent or uncertain; never use today's date, copyright year, crawl time or last-modified date.",
      },
      source_date_kind: {
        type: ["string", "null"],
        enum: [...SOURCE_DATE_KINDS, null],
        description: "Meaning of the date, or null when no reliable source date exists.",
      },
    },
    required: ["title", "tldr", "suggested_tag_slugs", "source_published_at", "source_date_kind"],
  } as const;
}
