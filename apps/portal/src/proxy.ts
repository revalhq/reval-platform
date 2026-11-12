import { type NextRequest, NextResponse } from "next/server";

// Must match SESSION_COOKIE in apps/api/src/plugins/auth.ts.
const SESSION_COOKIE = "rv_session";
const PUBLIC_PAGES = ["/login", "/register"];

/**
 * Cheap gate based on cookie presence only; the API is the real authority. An expired
 * cookie gets through here, then the first API call returns 401 and the client redirects.
 */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PAGES.includes(pathname);

  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip the API proxy (uploads must stream through untouched), Next internals and static files.
  matcher: ["/((?!portal/|_next/|favicon\\.ico|.*\\.(?:svg|png|ico|txt)$).*)"],
};
