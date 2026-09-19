import { z } from "zod";
import { ApiError, apiErrorResponse, apiSuccess, mapDatabaseError, parseJsonBody } from "@/lib/api";
import { authenticateRequest, requireRole } from "@/lib/auth";
import { apiTokenScopeSchema, roleCanUseScopes } from "@/lib/auth/roles";
import { generateApiToken } from "@/lib/auth/tokens";

const createTokenSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(apiTokenScopeSchema)
    .min(1)
    .max(3)
    .transform((scopes) => Array.from(new Set(scopes))),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
const organizationListSchema = z.strictObject({
  view: z.literal("organization"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
const organizationTokenSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  name: z.string(),
  token_prefix: z.string(),
  scopes: z.array(apiTokenScopeSchema),
  expires_at: z.string().nullable(),
  last_used_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});
const profileEmailSchema = z.object({ id: z.uuid(), email: z.email() });
const ORGANIZATION_PAGE_SIZE = 50;

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request, {
      allowApiToken: false,
    });
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)) {
      throw new ApiError(400, "VALIDATION_ERROR", "The token-list query is invalid");
    }
    if ([...url.searchParams.keys()].some((key) => !["view", "page"].includes(key))) {
      throw new ApiError(400, "VALIDATION_ERROR", "The token-list query is invalid");
    }
    if (url.searchParams.get("view") === "organization") {
      requireRole(actor, ["administrator"]);
      const input = organizationListSchema.parse({
        view: url.searchParams.get("view"),
        page: url.searchParams.get("page") ?? 1,
      });
      const start = (input.page - 1) * ORGANIZATION_PAGE_SIZE;
      const { data, error, count } = await actor.supabase
        .from("api_tokens")
        .select(
          "id, user_id, name, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at",
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .range(start, start + ORGANIZATION_PAGE_SIZE - 1);
      if (error) {
        throw new ApiError(500, "TOKEN_LIST_FAILED", "Unable to list organization API tokens");
      }

      const tokens = z.array(organizationTokenSchema).parse(data ?? []);
      const userIds = [...new Set(tokens.map((token) => token.user_id))];
      const profileResult = userIds.length
        ? await actor.supabase.from("profiles").select("id, email").in("id", userIds)
        : { data: [], error: null };
      if (profileResult.error) {
        throw new ApiError(500, "TOKEN_LIST_FAILED", "Unable to load token owners");
      }
      const emailByUserId = new Map(
        z
          .array(profileEmailSchema)
          .parse(profileResult.data ?? [])
          .map((profile) => [profile.id, profile.email]),
      );

      return apiSuccess(
        {
          tokens: tokens.map((token) => ({
            ...token,
            owner_email: emailByUserId.get(token.user_id) ?? null,
          })),
          total: count ?? 0,
          page: input.page,
          pageSize: ORGANIZATION_PAGE_SIZE,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (url.searchParams.has("page") || url.searchParams.has("view")) {
      throw new ApiError(400, "VALIDATION_ERROR", "The token-list query is invalid");
    }
    const { data, error } = await actor.supabase
      .from("api_tokens")
      .select("id, name, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at")
      .eq("user_id", actor.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      throw new ApiError(500, "TOKEN_LIST_FAILED", "Unable to list API tokens");
    }

    return apiSuccess({ tokens: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request, {
      allowApiToken: false,
      requireCsrf: true,
    });
    const input = await parseJsonBody(request, createTokenSchema);

    if (!roleCanUseScopes(actor.role, input.scopes)) {
      throw new ApiError(
        403,
        "SCOPE_NOT_ALLOWED",
        "One or more scopes are not available to this account role",
      );
    }

    let expiresAt: string | null = null;
    if (input.expiresAt) {
      const expires = new Date(input.expiresAt);
      const maximum = Date.now() + 366 * 24 * 60 * 60 * 1000;
      if (expires.getTime() <= Date.now() || expires.getTime() > maximum) {
        throw new ApiError(
          400,
          "INVALID_EXPIRATION",
          "Token expiration must be in the future and no more than 366 days away",
        );
      }
      expiresAt = expires.toISOString();
    }

    const generated = generateApiToken();
    const { data, error } = await actor.supabase
      .rpc("create_api_token", {
        p_actor_user_id: actor.user.id,
        p_name: input.name,
        p_token_prefix: generated.tokenPrefix,
        p_token_hash: generated.tokenHash,
        p_scopes: input.scopes,
        p_expires_at: expiresAt,
      })
      .single();

    if (error || !data) {
      if (error) {
        throw mapDatabaseError(error, "TOKEN_CREATE_FAILED", "Unable to create API token");
      }
      throw new ApiError(500, "TOKEN_CREATE_FAILED", "Unable to create API token");
    }

    return apiSuccess(
      {
        token: generated.rawToken,
        apiToken: data,
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
