import { cookies } from "next/headers";

// Must match SESSION_COOKIE in apps/api/src/plugins/auth.ts.
export const SESSION_COOKIE = "rv_session";

/** Server-side: whether a session cookie is present. Presence only; the API decides if it's valid. */
export async function hasSession() {
  return Boolean((await cookies()).get(SESSION_COOKIE)?.value);
}
