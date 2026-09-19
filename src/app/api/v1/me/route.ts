import {
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
      scopes: ["profile:read"],
    });

    return withCors(
      apiSuccess(
        {
          user: {
            id: actor.user.id,
            email: actor.profile.email,
            role: actor.role,
          },
          scopes: [...actor.scopes],
        },
        { headers: { "Cache-Control": "no-store" } },
      ),
      corsHeaders,
    );
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
