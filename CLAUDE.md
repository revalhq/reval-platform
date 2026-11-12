# Reval – project context

Paid SaaS for evaluating AI-powered apps. **Clients run their own app in their own environment**
(we never host client code). Thin client packages fetch tasks from our backend, call the client's
solver, and send outputs back. The backend stores everything and the portal shows runs, GitLab-pipeline style.

## Decisions already made (don't revisit without asking)

- **Thin clients, server-side policy.** Repeats, timeouts, concurrency, retry/give-up rules all live in
  the backend and are sent to clients. Client packages (Node first; later Python, PHP, Java) only:
  auth → start run → lease → call solver → submit results. Keep them small and dependency-light.
- **One standalone CLI** later (`--url` for HTTP solvers, `--cmd` for stdin/stdout solvers, `--fail-under` for CI).
- **Lease-based job queue in Postgres** (`FOR UPDATE SKIP LOCKED`), no Redis yet.
- **`expected` values never leave the server.** Clients only receive `input`.
- **Evaluation/scoring is out of scope for now.** The `evaluations` table is a placeholder. Raw outputs
  are always stored so runs can be scored later without re-executing.
- **Rerun is out of scope for now.** (Later: re-score stored outputs, and a "runner mode" CLI that polls for queued runs.)
- **Cheating safeguards are out of scope** (clients evaluate their own product). No offline/air-gapped support.
- **Billing via Stripe** (Checkout + webhooks + customer portal). `BILLING_MODE=dev` bypasses Stripe locally; refused in production.
- **Organizations from day one:** org → members (owner/admin/member) → projects → datasets → immutable versions → items.
- Future metrics will include non-deterministic qualities (e.g. friendliness, factuality via LLM judges), so keep
  outputs generic JSON and attach client metadata (tokens, cost, model, latency).

## Layout

- `apps/api` – Fastify + Zod + Drizzle + Postgres (TypeScript, ESM, `.js` import suffixes)
  - `src/routes/v1` – public API for client packages (API key auth, rate limited). **Backwards compatible only.**
  - `src/routes/portal` – portal API for the Next.js UI (session cookie auth)
  - `src/routes/webhooks.ts` – Stripe
  - `src/services/runs.ts` – run lifecycle: create, lease, submit results, finalize, cancel
  - `src/db/schema.ts` – schema; `drizzle/` – generated migrations
  - `openapi.json` – exported contract for client packages (`npm run openapi`)
- `apps/portal` – Next.js 16 admin portal (App Router, client components + SWR, Tailwind v4)
  - `next.config.ts` rewrites `/portal/*` → `API_URL` (beforeFiles) so the session cookie is same-origin
  - `src/proxy.ts` (Next 16's middleware) – cookie-presence gate; `src/lib/api.ts` – fetch wrapper, 401 → `/login?next=`
  - `src/lib/types.ts` mirrors portal API responses – update it when portal route shapes change
  - Routes are slug-based (`/[org]/runs/[number]`, `/[org]/settings/billing`) because the API builds those URLs
    (`/v1` run links, Stripe return URLs). Reserved org slugs live in `apps/api/src/routes/portal/auth.ts`.

## Conventions

- Every error response: `{ "error": { "code", "message", "details?" } }` via `HttpError`.
- Validate all input with Zod schemas on the route (this also generates OpenAPI). Public `/v1` routes declare response schemas.
- Org-scoped portal routes use `requireOrgRole(minRole)`; return 404 (not 403) for orgs the user isn't in.
- Log significant actions with `audit()`.
- After schema changes: `npm run db:generate`, then regenerate `openapi.json` if routes changed.

## Commands (in apps/api)

- `npm test` – end-to-end tests on in-memory Postgres (PGlite); no Docker needed
- `npm run dev` – needs Postgres (`docker compose up -d db` from repo root) and `.env` (copy `.env.example`)
- `npm run typecheck`, `npm run build`, `npm run openapi`, `npm run db:generate`

## Commands (in apps/portal)

- `npm run dev` (port 3000; `API_URL` defaults to http://localhost:4000), `npm run build`, `npm run typecheck`

## Next steps

1. Node client package `runEval({ apiKey, project, dataset, solve, ... })` following the protocol in README.md.
2. Member invitations (portal Members page has a placeholder), email verification, password reset.
3. Portal: Dockerfile/compose service, browser e2e tests in CI.
