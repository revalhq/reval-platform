/**
 * Browser client for the portal API. Requests go to same-origin `/portal/*`, which Next.js
 * rewrites to the Fastify API, so the httpOnly session cookie is sent automatically.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Body = { json: unknown } | { text: string; contentType: string };

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Body;
  query?: Record<string, string | number | undefined | null>;
}

export function withQuery(path: string, query?: RequestOptions["query"]): string {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

let redirectingToLogin = false;

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  let body: string | undefined;
  if (opts.body && "json" in opts.body) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body.json);
  } else if (opts.body) {
    headers["content-type"] = opts.body.contentType;
    body = opts.body.text;
  }

  const res = await fetch(withQuery(`/portal${path}`, opts.query), {
    method: opts.method ?? (body !== undefined ? "POST" : "GET"),
    headers,
    body,
    credentials: "same-origin",
    cache: "no-store",
  });

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try { data = JSON.parse(text); } catch { /* non-JSON (e.g. proxy error page) */ }
  }

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    const apiError = new ApiError(
      res.status,
      err?.code ?? (res.status >= 500 ? "server_unavailable" : "error"),
      err?.message ?? (res.status >= 500 ? "The server is unavailable. Try again in a moment." : `Request failed (${res.status})`),
      err?.details,
    );
    // Session expired or missing: bounce to login, remembering where we were.
    if (res.status === 401 && apiError.code === "unauthorized" && typeof window !== "undefined" && !redirectingToLogin) {
      redirectingToLogin = true;
      const next = window.location.pathname + window.location.search;
      window.location.assign(`/login?next=${encodeURIComponent(next)}`);
    }
    throw apiError;
  }
  return data as T;
}

/** SWR fetcher: the key is the path under /portal. */
export const fetcher = <T>(path: string) => api<T>(path);

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

/** Only allow same-site relative redirects after login. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
