import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { isHttps, pageSecurityHeaders } from "@/lib/security-headers";

/**
 * Next 16 renamed the `middleware` convention to `proxy`.
 *
 * Two jobs, neither of which may touch the database — proxy runs before the
 * app and must stay cheap:
 *
 * 1. An *optimistic* gate on the dashboard. It checks only for the presence of
 *    a session cookie. The authoritative check is `app/dashboard/layout.tsx`,
 *    which validates the session server-side. Never rely on this file alone
 *    for access control.
 * 2. Security headers on every page (lib/security-headers.ts), computed here
 *    rather than in next.config.ts because the right answer depends on
 *    whether the deployment is HTTPS, which a Docker build cannot know.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) &&
    !getSessionCookie(request)
  ) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);

    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();

  const headers = pageSecurityHeaders({
    https: isHttps(process.env.BETTER_AUTH_URL),
    dev: process.env.NODE_ENV === "development",
  });

  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value);
  }

  return response;
}

export const config = {
  matcher: [
    // Pages only. API routes set their own headers — the byte routes a much
    // stricter policy than a page could live with — and static assets need
    // none.
    "/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|llms.txt).*)",
  ],
};
