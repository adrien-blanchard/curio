import { z } from "zod";

const catalogAuthorLocalPart = /^[-a-z0-9_+'.]*[-a-z0-9_+]$/u;
const catalogAuthorDomain =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/u;

/** Mirrors private.attribution_email_valid in the Supabase migrations. */
export const catalogAuthorEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(320)
  .refine((email) => {
    const separator = email.indexOf("@");
    if (separator < 1 || separator !== email.lastIndexOf("@")) return false;
    const localPart = email.slice(0, separator);
    const domain = email.slice(separator + 1);
    return (
      localPart.length <= 64 &&
      catalogAuthorLocalPart.test(localPart) &&
      !localPart.startsWith(".") &&
      !localPart.endsWith(".") &&
      !localPart.includes("..") &&
      catalogAuthorDomain.test(domain)
    );
  }, "Invalid catalog author email");

export type CatalogAuthorEmail = z.infer<typeof catalogAuthorEmailSchema>;
