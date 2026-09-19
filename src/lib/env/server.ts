import "server-only";

import { z } from "zod";
import {
  booleanFromEnvironment,
  commaSeparatedValues,
  httpUrl,
  optionalString,
  optionalUrl,
  parseEnvironment,
} from "./shared";

const appRoleSchema = z.enum(["reader", "contributor", "administrator"]);

const emailDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    "must be a bare DNS email domain without @",
  );

const normalizedEmailSchema = z.email().transform((email) => email.toLowerCase());

const initialAdministratorEmailListSchema = z.preprocess(
  commaSeparatedValues,
  z
    .array(normalizedEmailSchema)
    .min(1, "at least one bootstrap administrator email is required")
    .transform((emails) => [...new Set(emails)]),
);

const domainListSchema = z.preprocess(
  commaSeparatedValues,
  z.array(emailDomainSchema).transform((domains) => [...new Set(domains)]),
);

const allowedEmailAddressListSchema = z.preprocess(
  commaSeparatedValues,
  z.array(normalizedEmailSchema).transform((emails) => [...new Set(emails)]),
);

const extensionIdListSchema = z.preprocess(
  commaSeparatedValues,
  z.array(
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-p]{32}$/, "must be a 32-character Chrome extension ID"),
  ),
);

const baseServerEnvironmentSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(1).default("Curio"),
  ),
  NEXT_PUBLIC_ORGANIZATION_NAME: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().default(""),
  ),
  NEXT_PUBLIC_APP_URL: httpUrl,
  NEXT_PUBLIC_DEMO_ENABLED: booleanFromEnvironment.default(false),
  NEXT_PUBLIC_SUPABASE_URL: httpUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().trim().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1),
  ALLOWED_EMAIL_DOMAINS: domainListSchema,
  ALLOWED_EMAIL_ADDRESSES: allowedEmailAddressListSchema,
  DEFAULT_USER_ROLE: appRoleSchema.exclude(["administrator"]).default("contributor"),
  INITIAL_ADMIN_EMAILS: initialAdministratorEmailListSchema,
  EXTENSION_ENABLED: booleanFromEnvironment.default(false),
  ALLOWED_EXTENSION_IDS: extensionIdListSchema,
  NEXT_PUBLIC_EXTENSION_INSTALL_URL: optionalUrl,
  PRIVACY_CONTACT_EMAIL: z.email().transform((email) => email.toLowerCase()),
  API_TOKEN_PEPPER: z.string().min(32),
  GEMINI_API_KEY: z.string().trim().min(1),
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.1-flash-lite"),
  THUMBNAIL_PROVIDER: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.enum(["none", "microlink"]).default("none"),
  ),
  MICROLINK_API_KEY: optionalString,
});

function validateAccessConfiguration(
  environment: Pick<
    z.infer<typeof baseServerEnvironmentSchema>,
    | "NEXT_PUBLIC_APP_URL"
    | "NEXT_PUBLIC_SUPABASE_URL"
    | "ALLOWED_EMAIL_DOMAINS"
    | "ALLOWED_EMAIL_ADDRESSES"
    | "INITIAL_ADMIN_EMAILS"
    | "EXTENSION_ENABLED"
    | "ALLOWED_EXTENSION_IDS"
    | "NEXT_PUBLIC_EXTENSION_INSTALL_URL"
  >,
  context: z.RefinementCtx,
) {
  const applicationUrl = new URL(environment.NEXT_PUBLIC_APP_URL);
  const localHostname =
    applicationUrl.hostname === "localhost" ||
    applicationUrl.hostname.endsWith(".localhost") ||
    applicationUrl.hostname === "0.0.0.0" ||
    applicationUrl.hostname === "[::1]" ||
    /^127(?:[.]\d{1,3}){3}$/u.test(applicationUrl.hostname);

  if (applicationUrl.pathname !== "/") {
    context.addIssue({
      code: "custom",
      path: ["NEXT_PUBLIC_APP_URL"],
      message: "must be an origin without a path",
    });
  }

  if (
    process.env.NODE_ENV === "production" &&
    (applicationUrl.protocol !== "https:" || localHostname)
  ) {
    context.addIssue({
      code: "custom",
      path: ["NEXT_PUBLIC_APP_URL"],
      message: "must be a non-local HTTPS origin in production",
    });
  }

  if (environment.EXTENSION_ENABLED && environment.ALLOWED_EXTENSION_IDS.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["ALLOWED_EXTENSION_IDS"],
      message: "at least one extension ID is required when extensions are enabled",
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

  if (
    environment.ALLOWED_EMAIL_DOMAINS.length === 0 &&
    environment.ALLOWED_EMAIL_ADDRESSES.length === 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["ALLOWED_EMAIL_DOMAINS"],
      message: "at least one of ALLOWED_EMAIL_DOMAINS or ALLOWED_EMAIL_ADDRESSES is required",
    });
  }

  for (const email of environment.INITIAL_ADMIN_EMAILS) {
    const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
    if (
      !environment.ALLOWED_EMAIL_ADDRESSES.includes(email) &&
      !environment.ALLOWED_EMAIL_DOMAINS.includes(domain)
    ) {
      context.addIssue({
        code: "custom",
        path: ["INITIAL_ADMIN_EMAILS"],
        message: "contains an address outside ALLOWED_EMAIL_ADDRESSES and ALLOWED_EMAIL_DOMAINS",
      });
    }
  }

  if (
    applicationUrl.username ||
    applicationUrl.password ||
    applicationUrl.search ||
    applicationUrl.hash
  ) {
    context.addIssue({
      code: "custom",
      path: ["NEXT_PUBLIC_APP_URL"],
      message: "must not contain credentials, a query, or a fragment",
    });
  }

  const supabaseUrl = new URL(environment.NEXT_PUBLIC_SUPABASE_URL);
  if (
    supabaseUrl.username ||
    supabaseUrl.password ||
    supabaseUrl.search ||
    supabaseUrl.hash ||
    supabaseUrl.pathname !== "/"
  ) {
    context.addIssue({
      code: "custom",
      path: ["NEXT_PUBLIC_SUPABASE_URL"],
      message: "must be an origin without credentials, a path, a query, or a fragment",
    });
  }
  if (process.env.NODE_ENV === "production" && supabaseUrl.protocol !== "https:") {
    context.addIssue({
      code: "custom",
      path: ["NEXT_PUBLIC_SUPABASE_URL"],
      message: "must use HTTPS in production",
    });
  }
}

const authEnvironmentSchema = baseServerEnvironmentSchema
  .omit({
    GEMINI_API_KEY: true,
    GEMINI_MODEL: true,
    THUMBNAIL_PROVIDER: true,
    MICROLINK_API_KEY: true,
  })
  .superRefine(validateAccessConfiguration);

const serverEnvironmentSchema = baseServerEnvironmentSchema.superRefine(
  validateAccessConfiguration,
);

export type AuthEnvironment = z.infer<typeof authEnvironmentSchema> & {
  APP_ORIGIN: string;
};

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema> & {
  APP_ORIGIN: string;
};

let cachedAuthEnvironment: AuthEnvironment | undefined;
let cachedServerEnvironment: ServerEnvironment | undefined;

function serverEnvironmentInput() {
  return {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_ORGANIZATION_NAME: process.env.NEXT_PUBLIC_ORGANIZATION_NAME,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_DEMO_ENABLED: process.env.NEXT_PUBLIC_DEMO_ENABLED,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ALLOWED_EMAIL_DOMAINS: process.env.ALLOWED_EMAIL_DOMAINS,
    ALLOWED_EMAIL_ADDRESSES: process.env.ALLOWED_EMAIL_ADDRESSES,
    DEFAULT_USER_ROLE: process.env.DEFAULT_USER_ROLE,
    INITIAL_ADMIN_EMAILS: process.env.INITIAL_ADMIN_EMAILS,
    EXTENSION_ENABLED: process.env.EXTENSION_ENABLED,
    ALLOWED_EXTENSION_IDS: process.env.ALLOWED_EXTENSION_IDS,
    NEXT_PUBLIC_EXTENSION_INSTALL_URL: process.env.NEXT_PUBLIC_EXTENSION_INSTALL_URL,
    PRIVACY_CONTACT_EMAIL: process.env.PRIVACY_CONTACT_EMAIL,
    API_TOKEN_PEPPER: process.env.API_TOKEN_PEPPER,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    THUMBNAIL_PROVIDER: process.env.THUMBNAIL_PROVIDER,
    MICROLINK_API_KEY: process.env.MICROLINK_API_KEY,
  };
}

function withDerivedOrigin<T extends { NEXT_PUBLIC_APP_URL: string }>(
  environment: T,
): T & { APP_ORIGIN: string } {
  return {
    ...environment,
    APP_ORIGIN: new URL(environment.NEXT_PUBLIC_APP_URL).origin,
  };
}

/** Auth/API configuration, intentionally independent from Gemini configuration. */
export function getAuthEnv(): AuthEnvironment {
  cachedAuthEnvironment ??= withDerivedOrigin(
    parseEnvironment("authentication", authEnvironmentSchema, serverEnvironmentInput()),
  );
  return cachedAuthEnvironment;
}

/** Full server configuration for workflow/analyzer entry points. */
export function getServerEnv(): ServerEnvironment {
  cachedServerEnvironment ??= withDerivedOrigin(
    parseEnvironment("server", serverEnvironmentSchema, serverEnvironmentInput()),
  );
  return cachedServerEnvironment;
}

export function getGeminiEnv(): Pick<ServerEnvironment, "GEMINI_API_KEY" | "GEMINI_MODEL"> {
  const schema = z.object({
    GEMINI_API_KEY: z.string().trim().min(1),
    GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.1-flash-lite"),
  });
  return parseEnvironment("Gemini", schema, {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
  });
}

export function getOptionalServerMetadata() {
  const schema = z.object({
    NEXT_PUBLIC_APP_URL: optionalUrl,
    PRIVACY_CONTACT_EMAIL: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.email().optional(),
    ),
    DEFAULT_USER_ROLE: appRoleSchema.exclude(["administrator"]).default("contributor"),
    EXTENSION_ENABLED: booleanFromEnvironment.default(false),
    NEXT_PUBLIC_EXTENSION_INSTALL_URL: optionalUrl,
    GEMINI_MODEL: optionalString.default("gemini-3.1-flash-lite"),
  });
  return parseEnvironment("optional server metadata", schema, {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    PRIVACY_CONTACT_EMAIL: process.env.PRIVACY_CONTACT_EMAIL,
    DEFAULT_USER_ROLE: process.env.DEFAULT_USER_ROLE,
    EXTENSION_ENABLED: process.env.EXTENSION_ENABLED,
    NEXT_PUBLIC_EXTENSION_INSTALL_URL: process.env.NEXT_PUBLIC_EXTENSION_INSTALL_URL,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
  });
}
