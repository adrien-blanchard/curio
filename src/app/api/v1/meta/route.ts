import { apiErrorResponse, apiSuccess } from "@/lib/api";
import { getPublicEnv } from "@/lib/env/public";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    const environment = getPublicEnv();
    return apiSuccess(
      {
        name: environment.NEXT_PUBLIC_APP_NAME,
        organization: environment.NEXT_PUBLIC_ORGANIZATION_NAME.trim() || null,
      },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
