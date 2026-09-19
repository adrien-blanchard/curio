import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env/public";
import { getAuthEnv } from "@/lib/env/server";
import { isEmailAllowed } from "@/lib/auth/domain";

const publicPagePrefixes = ["/demo", "/privacy", "/login", "/auth"];

function isPublicPage(pathname: string) {
  return (
    pathname === "/" ||
    publicPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
}

function redirectWithCookies(url: URL, source: NextResponse) {
  const response = NextResponse.redirect(url);
  for (const cookie of source.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

function unavailableBackendResponse(request: NextRequest) {
  const publicEnvironment = getPublicEnv();
  if (isPublicPage(request.nextUrl.pathname)) return NextResponse.next();

  const url = request.nextUrl.clone();
  if (publicEnvironment.NEXT_PUBLIC_DEMO_ENABLED) {
    url.pathname = "/demo";
    url.search = "";
  } else {
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("error", "configuration_unavailable");
  }
  return NextResponse.redirect(url);
}

/**
 * Refreshes the Supabase cookie and performs a page-level optimistic guard.
 * Route handlers and DAL functions must still call the secure auth guards.
 */
export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/")) return NextResponse.next();

  let environment: ReturnType<typeof getAuthEnv>;
  try {
    environment = getAuthEnv();
  } catch {
    return unavailableBackendResponse(request);
  }

  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (isPublicPage(pathname)) return supabaseResponse;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return redirectWithCookies(url, supabaseResponse);
  }

  if (
    !isEmailAllowed(
      user.email,
      environment.ALLOWED_EMAIL_DOMAINS,
      environment.ALLOWED_EMAIL_ADDRESSES,
    )
  ) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("error", "domain_not_allowed");
    return redirectWithCookies(url, supabaseResponse);
  }

  // Profile, database allowlist, and role checks belong to each protected page or API.
  // Keeping the Proxy optimistic avoids making it the authorization boundary.
  return supabaseResponse;
}
