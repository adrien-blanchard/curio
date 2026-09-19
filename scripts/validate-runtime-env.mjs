import { z } from "zod";

const emptyToUndefined = (value) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const required = z.preprocess(emptyToUndefined, z.string().trim().min(1));
const requiredUrl = z.preprocess(emptyToUndefined, z.url());
const booleanValue = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());
const csv = (value) =>
  typeof value === "string"
    ? [
        ...new Set(
          value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];
const domainList = z.preprocess(
  csv,
  z
    .array(
      z
        .string()
        .toLowerCase()
        .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$/u),
    )
    .transform((values) => [...new Set(values)]),
);
const emailList = z.preprocess(
  csv,
  z
    .array(z.email().transform((email) => email.toLowerCase()))
    .transform((values) => [...new Set(values)]),
);
const requiredEmailList = z.preprocess(
  csv,
  z
    .array(z.email().transform((email) => email.toLowerCase()))
    .min(1)
    .transform((values) => [...new Set(values)]),
);

function httpOrigin(value, path, context) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    context.addIssue({ code: "custom", path: [path], message: "must use HTTP or HTTPS" });
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    context.addIssue({
      code: "custom",
      path: [path],
      message: "must be an origin without credentials or a path",
    });
  }
  return url;
}

function isLocalHostname(hostname) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    /^127(?:[.]\d{1,3}){3}$/u.test(hostname)
  );
}

const schema = z
  .object({
    NEXT_PUBLIC_APP_NAME: required,
    NEXT_PUBLIC_ORGANIZATION_NAME: z.string().default(""),
    NEXT_PUBLIC_APP_URL: requiredUrl,
    NEXT_PUBLIC_DEMO_ENABLED: booleanValue,
    NEXT_PUBLIC_SUPABASE_URL: requiredUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: required,
    SUPABASE_SERVICE_ROLE_KEY: required,
    API_TOKEN_PEPPER: z.string().min(32),
    ALLOWED_EMAIL_ADDRESSES: emailList,
    ALLOWED_EMAIL_DOMAINS: domainList,
    DEFAULT_USER_ROLE: z.enum(["reader", "contributor"]),
    INITIAL_ADMIN_EMAILS: requiredEmailList,
    GEMINI_API_KEY: required,
    GEMINI_MODEL: required,
    THUMBNAIL_PROVIDER: z.preprocess(
      emptyToUndefined,
      z.enum(["none", "microlink"]).default("none"),
    ),
    MICROLINK_API_KEY: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
    EXTENSION_ENABLED: booleanValue,
    ALLOWED_EXTENSION_IDS: z.preprocess(csv, z.array(z.string().regex(/^[a-p]{32}$/u))),
    NEXT_PUBLIC_EXTENSION_INSTALL_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    PRIVACY_CONTACT_EMAIL: z.email(),
  })
  .superRefine((environment, context) => {
    if (
      environment.ALLOWED_EMAIL_ADDRESSES.length === 0 &&
      environment.ALLOWED_EMAIL_DOMAINS.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["ALLOWED_EMAIL_ADDRESSES"],
        message: "or ALLOWED_EMAIL_DOMAINS must contain at least one allowed identity",
      });
    }

    const applicationUrl = httpOrigin(
      environment.NEXT_PUBLIC_APP_URL,
      "NEXT_PUBLIC_APP_URL",
      context,
    );
    const supabaseUrl = httpOrigin(
      environment.NEXT_PUBLIC_SUPABASE_URL,
      "NEXT_PUBLIC_SUPABASE_URL",
      context,
    );
    if (process.env.VERCEL === "1") {
      for (const [path, url] of [
        ["NEXT_PUBLIC_APP_URL", applicationUrl],
        ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
      ]) {
        if (url.protocol !== "https:" || isLocalHostname(url.hostname)) {
          context.addIssue({
            code: "custom",
            path: [path],
            message: "must be a non-local HTTPS origin on Vercel",
          });
        }
      }
    }
    for (const email of environment.INITIAL_ADMIN_EMAILS) {
      const isAllowed =
        environment.ALLOWED_EMAIL_ADDRESSES.includes(email) ||
        environment.ALLOWED_EMAIL_DOMAINS.includes(email.split("@").at(-1));
      if (!isAllowed) {
        context.addIssue({
          code: "custom",
          path: ["INITIAL_ADMIN_EMAILS"],
          message:
            "contains an address not covered by ALLOWED_EMAIL_ADDRESSES or ALLOWED_EMAIL_DOMAINS",
        });
      }
    }
    if (environment.EXTENSION_ENABLED && environment.ALLOWED_EXTENSION_IDS.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["ALLOWED_EXTENSION_IDS"],
        message: "requires at least one ID when the extension is enabled",
      });
    }

    if (environment.NEXT_PUBLIC_EXTENSION_INSTALL_URL) {
      const installUrl = new URL(environment.NEXT_PUBLIC_EXTENSION_INSTALL_URL);
      const pathSegments = installUrl.pathname.split("/").filter(Boolean);
      const extensionId = pathSegments.at(-1)?.toLowerCase() ?? "";
      const isChromeWebStoreUrl =
        installUrl.protocol === "https:" &&
        installUrl.hostname === "chromewebstore.google.com" &&
        pathSegments.at(0) === "detail" &&
        /^[a-p]{32}$/u.test(extensionId) &&
        !installUrl.username &&
        !installUrl.password &&
        !installUrl.search &&
        !installUrl.hash;

      if (!isChromeWebStoreUrl) {
        context.addIssue({
          code: "custom",
          path: ["NEXT_PUBLIC_EXTENSION_INSTALL_URL"],
          message: "must be a direct HTTPS Chrome Web Store detail URL",
        });
      } else if (
        environment.EXTENSION_ENABLED &&
        !environment.ALLOWED_EXTENSION_IDS.includes(extensionId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["NEXT_PUBLIC_EXTENSION_INSTALL_URL"],
          message: "extension ID must be present in ALLOWED_EXTENSION_IDS",
        });
      }
    }
  });

const result = schema.safeParse(process.env);
if (!result.success) {
  const issues = result.error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid production build environment: ${issues}`);
}

process.stdout.write("Production build environment validated.\n");
