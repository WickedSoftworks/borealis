import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Next 16 renamed the `middleware` convention to `proxy`.
 *
 * This is an *optimistic* gate: it only checks for the presence of a session
 * cookie, because proxy runs detached from the app and must not touch the
 * database. The authoritative check is `app/dashboard/layout.tsx`, which
 * validates the session server-side. Never rely on this file alone for access
 * control.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
