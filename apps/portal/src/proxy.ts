import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/** "/" is the public landing page when signed out (see src/app/page.tsx). */
const PUBLIC_PAGES = ["/", "/login", "/register"];
/** Path prefixes readable without signing in (the prefix itself and anything below it). */
const PUBLIC_PREFIXES = ["/docs"];

/**
 * Cheap gate based on cookie presence only; the API is the real authority. An expired
 * cookie gets through here, then the first API call returns 401 and the client redirects.
 */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PAGES.includes(pathname)
    || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip the API proxy (uploads must stream through untouched), Next internals and static files.
  matcher: ["/((?!portal/|_next/|favicon\\.ico|.*\\.(?:svg|png|ico|txt)$).*)"],
};
