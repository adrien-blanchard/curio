import {
  ApiError,
  apiErrorResponse,
  apiSuccess,
  extensionCorsHeaders,
  extensionPreflight,
  withCors,
} from "@/lib/api";
import { authenticateRequest } from "@/lib/auth";

const methods = ["GET", "OPTIONS"] as const;

export async function GET(request: Request) {
  let corsHeaders = new Headers();
  try {
    corsHeaders = extensionCorsHeaders(request, methods);
    const actor = await authenticateRequest(request, {
      scopes: ["tags:read"],
    });

    const result =
      actor.mode === "api_token"
        ? await actor.supabase.rpc("get_tags_with_token", {
            p_token_hash: actor.tokenHash,
          })
        : await actor.supabase
            .from("tags")
            .select("id, name, slug, color")
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true });

    const { data: tags, error } = result;

    if (error) {
      throw new ApiError(500, "TAGS_READ_FAILED", "Unable to load tags");
    }

    return withCors(apiSuccess({ tags: tags ?? [] }), corsHeaders);
  } catch (error) {
    return withCors(apiErrorResponse(error), corsHeaders);
  }
}

export function OPTIONS(request: Request) {
  try {
    return extensionPreflight(request, methods);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
