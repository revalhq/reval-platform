# Reval

Clients run their own app; Reval hands out tasks, collects outputs and shows runs in a portal.
The client packages (Node, Python, PHP, Java, CLI) stay thin: all execution policy lives in this backend.

```
client project ──(API key)──▶ /v1   public API: start run, lease tasks, submit results
browser ────────(session)───▶ /portal  portal API for the Next.js admin UI
Stripe ─────────────────────▶ /webhooks/stripe
                                 │
                                 ▼
                              Postgres
```

## Run it

One command for local development: Postgres in Docker, the API (watch mode) and the portal.

```bash
make dev        # prints the portal and API URLs; Ctrl-C stops the API and portal
make help       # other targets: test, typecheck, build, stop, ...
```

It installs dependencies when lockfiles change, creates `apps/api/.env` from the example if missing,
and uses the first free portal port from 3000 (or `make dev PORTAL_PORT=3100`).

Or run everything in Docker (API only, no portal):

```bash
cp apps/api/.env.example apps/api/.env
docker compose up --build        # Postgres + API on http://localhost:4000
```

API docs (Swagger UI): http://localhost:4000/docs. Migrations run on startup (except on Vercel, where you run `npm run db:migrate` against the production `DATABASE_URL`).

Local development without Docker for the API:

```bash
docker compose up -d db
cd apps/api && npm install && npm run dev
npm test                         # end-to-end tests on an in-memory Postgres, no Docker needed
```

Portal (Next.js) on http://localhost:3000, talking to the API on :4000:

```bash
cd apps/portal && npm install && npm run dev
```

The portal proxies `/portal/*` to `API_URL` (default `http://localhost:4000`) through a Next.js rewrite,
so the session cookie stays same-origin. Rewrites are fixed at build time: set `API_URL` for `next build` too.
See `apps/portal/.env.example`. In dev billing mode, activate a subscription from Settings → Billing.

## The user journey, as API calls

1. **Register / log in** – `POST /portal/auth/register`, `POST /portal/auth/login` (session cookie).
2. **Pay** – `POST /portal/orgs/:orgId/billing/checkout` returns a Stripe Checkout URL; the Stripe
   webhook activates the subscription. In dev: `POST /portal/orgs/:orgId/billing/dev-activate`.
3. **Get an API key** – `POST /portal/orgs/:orgId/api-keys`. The secret is shown once; only a hash is stored.
4. **Add data** – create a project and dataset, then upload a version (JSON `{items:[...]}` or JSONL):
   each item is `{ id?, input, expected?, metadata? }`. Versions are immutable.
5. **Run from their code** – the client package calls `/v1` (protocol below).
6. **Watch and inspect** – `GET /portal/orgs/:orgId/runs`, `/runs/:number`, `/runs/:number/attempts`.

## Client protocol (what every package implements)

```
POST /v1/runs { project, dataset, repeats?, timeoutMs?, config?, tags?, trigger? }
  → { id, url, execution: { timeoutMs, concurrency, pollIntervalMs } }

loop:
  POST /v1/runs/{id}/lease { max }
    → { tasks: [{ attemptId, leaseId, itemId, input, ... }], done, retryAfterMs? }
  if tasks empty: stop if done, else sleep retryAfterMs and lease again
  for each task (up to `concurrency` at once, each limited to `timeoutMs`):
    call the user's solve(input) → output, or catch the error
  POST /v1/runs/{id}/results { results: [{ attemptId, leaseId, output | error, latencyMs, metadata }] }

print url
```

Rules the server enforces so clients don't have to:

- `expected` values never leave the server.
- A lease that isn't answered in time (timeout + grace) is handed out again; after 3 expiries the
  attempt is marked `abandoned`. Results carrying an old lease id are rejected, so each attempt has
  exactly one recorded outcome.
- Several clients can work the same run in parallel (`FOR UPDATE SKIP LOCKED`).
- The run completes automatically when no attempt is pending or leased.
- Clients should retry `/v1` calls on 429/5xx with backoff. Every error has the shape
  `{ "error": { "code", "message", "details?" } }`.

`apps/api/openapi.json` is the full contract (`npm run openapi` regenerates it). Use it to generate
the HTTP layer of each client package.

## Data model

Organizations → members (owner/admin/member) → projects → datasets → immutable versions → items.
Runs belong to a project and a dataset version, and record the `config` and `tags` being tested.
Each run has one **attempt** per item × repeat, holding the output, error, latency and client
metadata (tokens, cost, model). An empty `evaluations` table is reserved for the scoring stage.

## Portal

`apps/portal` – Next.js 16 (App Router), client-rendered pages with SWR, Tailwind. Routes use the org
slug, matching the links the API hands out (`/{org}/runs/{number}`, Stripe's `/{org}/settings/billing`):

- `/login`, `/register`, `/account` (change password)
- `/{org}/runs` – pipeline-style list: outcome, config, tags, trigger, live progress; filter by project/status
- `/{org}/runs/{number}` – progress, latency p50/p95, config, attempts (filter by status, expand for input/expected/output/metadata), cancel
- `/{org}/projects` → `/{org}/projects/{project}` → `/{org}/projects/{project}/datasets/{dataset}` (upload JSONL, browse versions)
- `/{org}/settings` – general, members, API keys (secret shown once), billing

`src/proxy.ts` redirects visitors without a session cookie to `/login`; the API remains the authority
(any 401 from it sends the browser to `/login?next=…`). Org slugs that would shadow portal pages
(`login`, `account`, …) are never issued by the API.

## Not built yet

- Inviting members to an organization
- Rerun / runner mode
- Evaluation (scoring) stage
- Dataset upload through `/v1` (for CI pipelines)
- Email verification and password reset
