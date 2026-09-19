import { z } from "zod";
import { ApiError, apiErrorResponse, apiSuccess, mapDatabaseError } from "@/lib/api";
import { authenticateRequest } from "@/lib/auth";

type TokenRouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: TokenRouteContext) {
  try {
    const actor = await authenticateRequest(request, {
      allowApiToken: false,
      requireCsrf: true,
    });
    const { id } = await context.params;
    const tokenId = z.uuid().parse(id);
    const { data, error } = await actor.supabase
      .rpc("revoke_api_token", {
        p_actor_user_id: actor.user.id,
        p_token_id: tokenId,
      })
      .single();

    if (error) {
      throw mapDatabaseError(error, "TOKEN_REVOKE_FAILED", "Unable to revoke API token");
    }
    if (!data) {
      throw new ApiError(404, "TOKEN_NOT_FOUND", "API token not found");
    }

    return apiSuccess({ token: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
