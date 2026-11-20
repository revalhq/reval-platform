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
POST /v1/runs { project, dataset, repeats?, timeoutMs?, config? | variants?, tags?, trigger? }
  → { id, url, variants: [{ name, config }], execution: { timeoutMs, concurrency, pollIntervalMs } }

loop:
  POST /v1/runs/{id}/lease { max }
    → { tasks: [{ attemptId, leaseId, itemId, variant, config, input, ... }], done, retryAfterMs? }
  if tasks empty: stop if done, else sleep retryAfterMs and lease again
  group tasks by (itemId, repeatIndex); for each group (up to `concurrency` groups at once):
    call the user's solve(input, config) for every task in the group at the same time,
    each limited to `timeoutMs` → output, or catch the error
  POST /v1/runs/{id}/results { results: [{ attemptId, leaseId, output | error, latencyMs, metadata }] }

print url
```

**Comparing configurations.** A run can test several configurations (variants), e.g. two models or two
prompts. Every variant runs every item, and the server hands out the variants of one item together, item
by item, so they run at the same moment under the same load. Which variants a run uses:

| `POST /v1/runs` sends            | Variants                                                         |
| -------------------------------- | ---------------------------------------------------------------- |
| neither `config` nor `variants`  | all variants saved on the project in the portal (or one empty `default`) |
| `config: {...}`                  | one variant named `default`                                      |
| `variants: ["gpt-5", ...]`       | those saved variants, by name                                    |
| `variants: [{ name, config }]`   | inline variants (can be mixed with names); up to 10 per run      |

A run copies each variant's config when it starts, so editing a saved variant never changes past runs.
The config is only a description: the client's solver applies it with its own credentials, which never reach Reval.

Rules the server enforces so clients don't have to:

- `expected` values never leave the server.
- A lease that isn't answered in time (timeout + grace) is handed out again; after 3 expiries the
  attempt is marked `abandoned`. Results carrying an old lease id are rejected, so each attempt has
  exactly one recorded outcome.
- Several clients can work the same run in parallel. Leasing is serialized per run (a short row lock),
  so one item's variants are never split between clients. A lease returns `floor(max / variants)` items,
  and at least one whole item even when a run has more variants than `max`.
- The run completes automatically when no attempt is pending or leased.
- Clients should retry `/v1` calls on 429/5xx with backoff. Every error has the shape
  `{ "error": { "code", "message", "details?" } }`.

`apps/api/openapi.json` is the full contract (`npm run openapi` regenerates it). Use it to generate
the HTTP layer of each client package.

### Usage metadata (tokens, cost)

Report usage in each result's `metadata` with these keys, and the portal sums them per variant and per
run (totals and averages), shows them next to every answer in the Compare view, and marks the cheapest variant:

| Key | Meaning |
|---|---|
| `inputTokens` | prompt / input tokens for this attempt |
| `outputTokens` | completion / output tokens |
| `totalTokens` | if your provider only reports a total |
| `costUsd` | cost of this attempt in US dollars |

Any other **numeric** key (e.g. `retrievedDocs`, `toolCalls`) is summed too and shown with its raw name;
strings (`model`, raw text) are stored and shown per attempt but not summed. Reval doesn't know model
prices: compute `costUsd` in the client from the token counts and your provider's current prices.
Usage is counted for errored attempts as well, since they cost money too.

### How a client app handles variants

A client's app doesn't need to know about Reval or about which variants exist. Each task arrives with its
variant's `config`, and the solver turns that config into settings for the app:

```
Reval ──task: { input, variant: "prompt-grid", config: { model, system_prompt, ... } }──▶ the solver(input, config)
                                                                                          │ maps config keys to settings
                                                                                          ▼
                                                                  the app (HTTP endpoint or function call)
```

| Who | Knows |
|---|---|
| Reval (portal/server) | which variants exist, their configs, and which ones a run uses |
| the solver (eval script) | how config keys map to the app's settings, e.g. `config["model"]` → `model=` |
| the app | nothing about Reval: it just accepts settings (model, prompt, ...) and falls back to defaults |

- **Adding or editing variants** in the portal needs no code change, as long as they only use keys the
  solver understands.
- **Varying something new** (say `max_tokens`) means teaching the solver and app that key.
- **Unknown keys do nothing.** A variant with a typo like `"temprature"` looks different in the portal but runs
  with the app's defaults. Consider failing on keys the solver doesn't recognise.
- **Production endpoints:** don't let any caller pick the model or prompt. Either call the solve function
  directly from the eval script, or accept these overrides only when an eval-only setting is enabled.

The zebra solver below follows this pattern: `main.py` only accepts settings, and
`evals/run_reval.py` maps `model` / `prompt` / `system_prompt` / `temperature` from the config to `/solve`.

## Trying it end to end (zebra solver + Python client)

Two sibling repos (next to this one in `~/Documents/PlayArea`) make a complete local test setup:

- `../reval-python` – the Python client package (`run_eval`, variants support, tests with a fake API).
- `../zebrasolver` – a sample client app: a FastAPI zebra-puzzle solver (`/solve` on port 3002, OpenAI)
  and `evals/run_reval.py`, which evaluates it through `reval-python`.

```bash
make dev                                   # this repo: API :4000 + portal :3000
# portal: register, Settings → Billing → activate (dev), Settings → API keys → create
# portal: project "zebra-app-1", dataset "set-1" with items like {"id": "z1", "input": {"puzzle": "..."}, "expected": "..."}
cd ../zebrasolver
pip install -r requirements.txt && pip install -e ../reval-python
# .env: OPENAI_API_KEY, REVAL_API_KEY, REVAL_BASE_URL=http://localhost:4000
uvicorn main:app --port 3002               # the app under test, in its own terminal
python evals/run_reval.py               # every puzzle × every saved variant
```

**Example variants** to save on the project (Projects → zebra-app-1 → Variants), then run
`python evals/run_reval.py` to compare them all:

| Name | Config |
|---|---|
| `gpt-4o` | `{"model": "gpt-4o", "prompt": "v1", "temperature": 0}` |
| `gpt-4o-mini` | `{"model": "gpt-4o-mini", "prompt": "v1", "temperature": 0}` |
| `gpt-4o-mini-grid` | `{"model": "gpt-4o-mini", "prompt": "v2", "temperature": 0}` |
| `gpt-4o-warm` | `{"model": "gpt-4o", "prompt": "v1", "temperature": 0.8}` (pass `repeats=3` to `run_eval`) |

Prompt variants: same model and temperature, only the prompt changes. Use `prompt` for the app's
built-in versions (`v1`, `v2`), or `system_prompt` for any prompt text; the app appends the JSON answer
format to it:

| Name | Config (paste into the portal) |
|---|---|
| `prompt-v1` | `{"model": "gpt-4o-mini", "prompt": "v1", "temperature": 0}` |
| `prompt-v2` | `{"model": "gpt-4o-mini", "prompt": "v2", "temperature": 0}` |
| `prompt-direct` | `{"model": "gpt-4o-mini", "temperature": 0, "system_prompt": "You solve zebra (Einstein) logic puzzles. Give the answer directly; keep the reasoning to one sentence."}` |
| `prompt-step-by-step` | `{"model": "gpt-4o-mini", "temperature": 0, "system_prompt": "You solve zebra (Einstein) logic puzzles. Think step by step: go through the clues one at a time and write down what each one tells you before giving the answer."}` |
| `prompt-grid` | `{"model": "gpt-4o-mini", "temperature": 0, "system_prompt": "You solve zebra (Einstein) logic puzzles. Build a grid with one row per house and one column per attribute. Fill it in starting with the clues that fix a single position, then the most constraining ones. Only answer once every cell is filled."}` |
| `prompt-self-check` | `{"model": "gpt-4o-mini", "temperature": 0, "system_prompt": "You solve zebra (Einstein) logic puzzles. Solve the puzzle, then check your solution against EVERY clue, one by one. If any clue is violated, fix the solution and check again. Only answer when all clues hold."}` |
| `prompt-few-shot` | `{"model": "gpt-4o-mini", "temperature": 0, "system_prompt": "You solve zebra (Einstein) logic puzzles. Example: 'Two houses. The Brit lives in the red house. The green house is on the left. The Dane does not live in house 2. Who lives in the green house?' Reasoning: the Dane must be in house 1, which is green (left), so the Brit is in house 2 (red). Answer: the Dane. Solve the next puzzle the same way."}` |

The zebra app's `/solve` accepts `model`, `prompt` (`v1`/`v2`) or `system_prompt` (text), and `temperature` per request, and the
eval script forwards each variant's config, so one running app answers as every variant. The run page
then shows success, latency and token totals per variant, and the Compare view puts the answers side by side.
To test without spending OpenAI credits, point `SOLVER_URL` at a stub that returns `{"answer": ...}`.

## Data model

Organizations → members (owner/admin/member) → projects → datasets → immutable versions → items.
Projects also hold saved **variants** (named configs). Editing items in the portal saves a new version.
Runs belong to a project and a dataset version, and have one or more **variants** (the configurations
being compared) plus `tags`. Each run has one **attempt** per item × repeat × variant, holding the output,
error, latency and client metadata (tokens, cost, model). An empty `evaluations` table is reserved for the scoring stage.

## Portal

`apps/portal` – Next.js 16 (App Router), client-rendered pages with SWR, Tailwind. Routes use the org
slug, matching the links the API hands out (`/{org}/runs/{number}`, Stripe's `/{org}/settings/billing`):

- `/login`, `/register`, `/account` (change password)
- `/{org}/runs` – pipeline-style list: outcome, config, tags, trigger, live progress; filter by project/status
- `/{org}/runs/{number}` – progress, latency p50/p95, config, attempts (filter by status, expand for input/expected/output/metadata), cancel.
  Multi-variant runs add a per-variant summary (success, latency, summed numeric metadata such as cost), a config
  diff, and a Compare view with items as rows and variants as columns
- `/{org}/projects` → `/{org}/projects/{project}` (datasets, saved variants) → `/{org}/projects/{project}/datasets/{dataset}`
  (upload JSONL, browse versions, edit items: changes are kept as a draft and saved as a new version)
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
