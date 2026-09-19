import { z } from "zod";

import { apiErrorResponse, apiSuccess, mapDatabaseError, parseJsonBody } from "@/lib/api";
import { authenticateRequest } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

const parametersSchema = z.object({ id: z.uuid() });
const updateRoleSchema = z.strictObject({
  role: z.enum(["reader", "contributor", "administrator"]),
});
const profileSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: z.enum(["reader", "contributor", "administrator"]),
  created_at: z.string(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = parametersSchema.parse(await context.params);
    const actor = await authenticateRequest(request, {
      roles: ["administrator"],
      allowApiToken: false,
      requireCsrf: true,
    });
    const input = await parseJsonBody(request, updateRoleSchema);
    const { data, error } = await createServiceRoleClient().rpc("update_profile_role", {
      p_actor_user_id: actor.user.id,
      p_profile_id: id,
      p_role: input.role,
    });
    if (error) {
      throw mapDatabaseError(error, "PROFILE_UPDATE_FAILED", "The user role could not be updated");
    }
    const profile = profileSchema.parse(Array.isArray(data) ? data[0] : data);
    return apiSuccess({
      id: profile.id,
      email: profile.email,
      role: profile.role,
      createdAt: profile.created_at,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
