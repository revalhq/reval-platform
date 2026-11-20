/**
 * Walks the user journey end to end against an in-memory Postgres (PGlite):
 * register → subscribe → API key → dataset → SDK-style run → portal views.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/build-app.js";
import { loadConfig } from "../src/config.js";
import type { Db } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";

async function setup(env: Record<string, string> = {}) {
  const client = new PGlite();
  const pdb = drizzle(client, { schema });
  await migrate(pdb, { migrationsFolder: "drizzle" });
  const db = pdb as unknown as Db;
  const config = loadConfig({ NODE_ENV: "test", LEASE_GRACE_MS: "0", ...env });
  const app = await buildApp(db, config);
  return { app, db };
}

/** Small client that keeps the session cookie, like a browser would. */
function portal(app: FastifyInstance) {
  let cookie = "";
  return async (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown,
                headers: Record<string, string> = {}) => {
    const res = await app.inject({ method, url, payload: payload as never, headers: { cookie, ...headers } });
    const set = res.headers["set-cookie"];
    if (set) cookie = (Array.isArray(set) ? set[0]! : set).split(";")[0]!;
    return { status: res.statusCode, body: res.body ? res.json() : undefined };
  };
}

function sdk(app: FastifyInstance, key: string) {
  return async (method: "GET" | "POST", url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, payload: payload as never, headers: { authorization: `Bearer ${key}` } });
    return { status: res.statusCode, body: res.json() };
  };
}

describe("user journey", () => {
  let app: FastifyInstance;
  let db: Db;
  let call: ReturnType<typeof portal>;
  let orgId: string;
  let orgSlug: string;
  let apiKey: string;
  let keyId: string;

  beforeAll(async () => {
    ({ app, db } = await setup());
    call = portal(app);
  });

  it("registers, logs in and sees their organization", async () => {
    const reg = await call("POST", "/portal/auth/register", {
      email: "ada@example.com", password: "correct-horse-battery", name: "Ada", organizationName: "Acme AI",
    });
    expect(reg.status).toBe(201);
    expect(reg.body.organizations[0]).toMatchObject({ name: "Acme AI", slug: "acme-ai", role: "owner", subscriptionStatus: "inactive" });
    orgId = reg.body.organizations[0].id;
    orgSlug = reg.body.organizations[0].slug;

    expect((await call("POST", "/portal/auth/register", { email: "ADA@example.com", password: "another-password", name: "X" })).status).toBe(409);
    expect((await call("POST", "/portal/auth/logout")).status).toBe(200);
    expect((await call("GET", "/portal/auth/me")).status).toBe(401);
    expect((await call("POST", "/portal/auth/login", { email: "ada@example.com", password: "wrong-password" })).status).toBe(401);
    expect((await call("POST", "/portal/auth/login", { email: "Ada@Example.com", password: "correct-horse-battery" })).status).toBe(200);
  });

  it("can't create API keys before paying, can after", async () => {
    const before = await call("POST", `/portal/orgs/${orgId}/api-keys`, { name: "CI" });
    expect(before.status).toBe(402);

    expect((await call("POST", `/portal/orgs/${orgId}/billing/dev-activate`)).status).toBe(200);
    const created = await call("POST", `/portal/orgs/${orgId}/api-keys`, { name: "CI" });
    expect(created.status).toBe(201);
    apiKey = created.body.secret;
    keyId = created.body.apiKey.id;
    expect(apiKey).toMatch(/^rv_live_[0-9A-Za-z]{32}$/);

    const list = await call("GET", `/portal/orgs/${orgId}/api-keys`);
    expect(list.body.apiKeys).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(apiKey); // secret never shown again

    const who = await sdk(app, apiKey)("GET", "/v1/whoami");
    expect(who.body.organization.slug).toBe(orgSlug);
  });

  it("creates a project and uploads a dataset (JSON and JSONL)", async () => {
    const p = await call("POST", `/portal/orgs/${orgId}/projects`, { name: "Zebra Solver" });
    expect(p.status).toBe(201);
    expect(p.body.project.slug).toBe("zebra-solver");
    const projectId = p.body.project.id;

    const d = await call("POST", `/portal/orgs/${orgId}/projects/${projectId}/datasets`, { name: "Zebra puzzles" });
    const datasetId = d.body.dataset.id;
    const base = `/portal/orgs/${orgId}/projects/${projectId}/datasets/${datasetId}`;

    const v1 = await call("POST", `${base}/versions`, {
      items: [
        { id: "p001", input: { puzzle: "Who owns the fish?" }, expected: "Ben" },
        { id: "p002", input: { puzzle: "Who owns the turtle?" }, expected: "Fay" },
      ],
    });
    expect(v1.status).toBe(201);
    expect(v1.body.version).toMatchObject({ version: 1, itemCount: 2 });

    const jsonl = [
      { id: "p001", input: { puzzle: "Who owns the fish?" }, expected: "Ben" },
      { id: "p002", input: { puzzle: "Who owns the turtle?" }, expected: "Fay" },
      { id: "p003", input: { puzzle: "Who drinks water?" }, expected: "Cy", metadata: { difficulty: "hard" } },
    ].map((x) => JSON.stringify(x)).join("\n");
    const v2 = await call("POST", `${base}/versions`, jsonl, { "content-type": "application/x-ndjson" });
    expect(v2.status).toBe(201);
    expect(v2.body.version).toMatchObject({ version: 2, itemCount: 3 });

    const bad = await call("POST", `${base}/versions`, '{"input": 1}\nnot json', { "content-type": "application/x-ndjson" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain("Line 2");
  });

  it("runs an evaluation the way the SDK would", async () => {
    const api = sdk(app, apiKey);
    const created = await api("POST", "/v1/runs", {
      project: "zebra-solver", dataset: "zebra-puzzles", repeats: 2, timeoutMs: 5_000,
      config: { model: "claude-sonnet-4-6", temperature: 0 }, tags: ["baseline"],
      trigger: { client: "node", version: "0.1.0" },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ number: 1, status: "queued", progress: { total: 6, pending: 6 } });
    expect(created.body.url).toBe(`http://localhost:3000/${orgSlug}/runs/1`);
    expect(created.body.execution.concurrency).toBe(4);
    const runId = created.body.id;

    // First lease: 4 of the 6 tasks. Inputs are sent, expected answers are not.
    const l1 = await api("POST", `/v1/runs/${runId}/lease`, { max: 4 });
    expect(l1.body.status).toBe("running");
    expect(l1.body.tasks).toHaveLength(4);
    expect(l1.body.tasks[0]).toMatchObject({
      itemId: "p001", repeatIndex: 0, variant: "default",
      config: { model: "claude-sonnet-4-6", temperature: 0 }, input: { puzzle: "Who owns the fish?" },
    });
    expect(JSON.stringify(l1.body)).not.toContain("Ben");

    // Submit 3 results; one is a solver error; one uses a bogus lease and is rejected.
    const [t0, t1, t2, t3] = l1.body.tasks;
    const r1 = await api("POST", `/v1/runs/${runId}/results`, {
      results: [
        { attemptId: t0.attemptId, leaseId: t0.leaseId, output: "Ben", latencyMs: 812, metadata: { outputTokens: 120, costUsd: 0.0021 } },
        { attemptId: t1.attemptId, leaseId: t1.leaseId, output: "Fay", latencyMs: 640 },
        { attemptId: t2.attemptId, leaseId: t2.leaseId, error: "Solver returned HTTP 500", latencyMs: 30 },
        { attemptId: t3.attemptId, leaseId: "00000000-0000-4000-8000-000000000000", output: "nope" },
      ],
    });
    expect(r1.body.accepted).toHaveLength(3);
    expect(r1.body.rejected).toEqual([{ attemptId: t3.attemptId, reason: "unknown_attempt_or_stale_lease" }]);

    // t3's client "crashes": force its lease to expire, then it is handed out again with a new lease id.
    await db.update(schema.attempts).set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.attempts.id, t3.attemptId));
    const l2 = await api("POST", `/v1/runs/${runId}/lease`, { max: 10 });
    expect(l2.body.tasks).toHaveLength(3); // 2 never-leased + the expired one
    const again = l2.body.tasks.find((t: { attemptId: string }) => t.attemptId === t3.attemptId);
    expect(again.leaseId).not.toBe(t3.leaseId);

    // The old lease's late result is rejected; the new one is accepted.
    const late = await api("POST", `/v1/runs/${runId}/results`, {
      results: [{ attemptId: t3.attemptId, leaseId: t3.leaseId, output: "late" }],
    });
    expect(late.body.accepted).toHaveLength(0);

    // Nothing left to hand out, but leases are outstanding: client should wait, not stop.
    const l3 = await api("POST", `/v1/runs/${runId}/lease`, { max: 10 });
    expect(l3.body).toMatchObject({ tasks: [], done: false, retryAfterMs: 2000 });

    const final = await api("POST", `/v1/runs/${runId}/results`, {
      results: l2.body.tasks.map((t: { attemptId: string; leaseId: string }) =>
        ({ attemptId: t.attemptId, leaseId: t.leaseId, output: "Cy", latencyMs: 500 })),
    });
    expect(final.body).toMatchObject({ status: "completed", accepted: expect.any(Array) });

    const status = await api("GET", `/v1/runs/${runId}`);
    expect(status.body.progress).toMatchObject({ total: 6, done: 6, succeeded: 5, errored: 1 });
    const l4 = await api("POST", `/v1/runs/${runId}/lease`, {});
    expect(l4.body).toMatchObject({ tasks: [], done: true, status: "completed" });
  });

  it("shows runs, details and attempts in the portal", async () => {
    const list = await call("GET", `/portal/orgs/${orgId}/runs`);
    expect(list.body.runs).toHaveLength(1);
    expect(list.body.runs[0]).toMatchObject({
      number: 1, status: "completed", config: { model: "claude-sonnet-4-6" }, tags: ["baseline"],
      project: { slug: "zebra-solver" }, dataset: { slug: "zebra-puzzles", version: 2 },
      progress: { succeeded: 5, errored: 1 },
    });

    const detail = await call("GET", `/portal/orgs/${orgId}/runs/1`);
    expect(detail.body.stats.latencyP50).toBeGreaterThan(0);

    const errored = await call("GET", `/portal/orgs/${orgId}/runs/1/attempts?status=errored`);
    expect(errored.body.total).toBe(1);
    expect(errored.body.attempts[0]).toMatchObject({ error: "Solver returned HTTP 500", item: { externalId: "p003", expected: "Cy" } });

    const org = await call("GET", `/portal/orgs/${orgId}`);
    expect(org.body.usage.attemptsSubmitted).toBe(6);
  });

  it("gives up on attempts whose lease keeps expiring, and supports cancel", async () => {
    const api = sdk(app, apiKey);
    const run = (await api("POST", "/v1/runs", { project: "zebra-solver", dataset: "zebra-puzzles", limit: 1, timeoutMs: 1000 })).body;
    expect(run.number).toBe(2);
    for (let i = 0; i < 3; i++) {
      const l = await api("POST", `/v1/runs/${run.id}/lease`, {});
      expect(l.body.tasks).toHaveLength(1);
      await db.execute(sql`UPDATE attempts SET lease_expires_at = now() - interval '1 second' WHERE run_id = ${run.id}`);
    }
    const last = await api("POST", `/v1/runs/${run.id}/lease`, {});
    expect(last.body).toMatchObject({ tasks: [], done: true, status: "completed" });
    expect((await api("GET", `/v1/runs/${run.id}`)).body.progress.abandoned).toBe(1);

    const run3 = (await api("POST", "/v1/runs", { project: "zebra-solver", dataset: "zebra-puzzles" })).body;
    const cancelled = await call("POST", `/portal/orgs/${orgId}/runs/${run3.number}/cancel`);
    expect(cancelled.body.run.status).toBe("cancelled");
    expect((await api("POST", `/v1/runs/${run3.id}/lease`, {})).body.done).toBe(true);
  });

  it("runs several variants side by side, item by item", async () => {
    const api = sdk(app, apiKey);
    const base = { project: "zebra-solver", dataset: "zebra-puzzles", limit: 2, timeoutMs: 5_000 };
    const variants = [
      { name: "gpt", config: { provider: "openai", model: "gpt-5" } },
      { name: "claude", config: { provider: "anthropic", model: "claude-sonnet-5-5" } },
    ];

    const both = await api("POST", "/v1/runs", { ...base, config: { model: "x" }, variants });
    expect(both.status).toBe(422);
    expect(both.body.error.code).toBe("config_and_variants");
    const dupe = await api("POST", "/v1/runs", { ...base, variants: [{ name: "a" }, { name: "a" }] });
    expect(dupe.body.error.code).toBe("duplicate_variant");

    const created = await api("POST", "/v1/runs", { ...base, variants });
    expect(created.status).toBe(201);
    expect(created.body.progress.total).toBe(4); // 2 items × 2 variants
    expect(created.body.variants).toEqual(variants);
    const runId = created.body.id;

    // max=3 → one whole group (both variants of p001); never half a group.
    const l1 = await api("POST", `/v1/runs/${runId}/lease`, { max: 3 });
    expect(l1.body.tasks.map((t: { itemId: string; variant: string }) => [t.itemId, t.variant]))
      .toEqual([["p001", "gpt"], ["p001", "claude"]]);
    expect(l1.body.tasks[1].config).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(JSON.stringify(l1.body)).not.toContain("Ben");

    // max=1 is less than the number of variants: the whole next group still comes back.
    const l2 = await api("POST", `/v1/runs/${runId}/lease`, { max: 1 });
    expect(l2.body.tasks.map((t: { itemId: string }) => t.itemId)).toEqual(["p002", "p002"]);

    const submit = (tasks: { attemptId: string; leaseId: string; variant: string }[]) =>
      api("POST", `/v1/runs/${runId}/results`, {
        results: tasks.map((t) => ({
          attemptId: t.attemptId, leaseId: t.leaseId, output: `${t.variant} answer`,
          latencyMs: t.variant === "gpt" ? 900 : 400, metadata: { costUsd: t.variant === "gpt" ? 0.02 : 0.01, model: t.variant },
        })),
      });
    expect((await submit(l1.body.tasks)).body.accepted).toHaveLength(2);
    const done = await submit(l2.body.tasks);
    expect(done.body.status).toBe("completed");

    const runNumber = created.body.number;
    const detail = await call("GET", `/portal/orgs/${orgId}/runs/${runNumber}`);
    expect(detail.body.run.variants.map((v: { name: string }) => v.name)).toEqual(["gpt", "claude"]);
    expect(detail.body.run.config).toEqual({});
    const [gptStats, claudeStats] = detail.body.stats.variants;
    expect(gptStats).toMatchObject({ progress: { total: 2, succeeded: 2 }, latencyP50: 900 });
    expect(gptStats.metadataTotals.costUsd).toEqual({ sum: 0.04, count: 2 });
    expect(claudeStats).toMatchObject({ latencyP50: 400, metadataTotals: { costUsd: { sum: 0.02, count: 2 } } });
    expect(gptStats.metadataTotals.model).toBeUndefined(); // only numeric metadata is summed

    const matrix = await call("GET", `/portal/orgs/${orgId}/runs/${runNumber}/matrix?limit=1&offset=1`);
    expect(matrix.body.total).toBe(2);
    expect(matrix.body.rows).toHaveLength(1);
    expect(matrix.body.rows[0]).toMatchObject({
      item: { externalId: "p002", expected: "Fay" }, repeatIndex: 0,
      attempts: [{ variant: { name: "gpt" }, output: "gpt answer" }, { variant: { name: "claude" }, output: "claude answer" }],
    });
    expect(matrix.body.rows[0].attempts[0].leasedAt).toBe(matrix.body.rows[0].attempts[1].leasedAt);

    const claudeOnly = await call("GET", `/portal/orgs/${orgId}/runs/${runNumber}/attempts?variantId=${claudeStats.variantId}`);
    expect(claudeOnly.body.total).toBe(2);
  });

  it("re-leases an expired attempt, and never splits a group between concurrent clients", async () => {
    const api = sdk(app, apiKey);
    const run = (await api("POST", "/v1/runs", {
      project: "zebra-solver", dataset: "zebra-puzzles", variants: [{ name: "a" }, { name: "b" }],
    })).body;
    const [c1, c2] = await Promise.all([
      api("POST", `/v1/runs/${run.id}/lease`, { max: 2 }),
      api("POST", `/v1/runs/${run.id}/lease`, { max: 2 }),
    ]);
    for (const l of [c1, c2]) {
      expect(l.body.tasks.map((t: { variant: string }) => t.variant)).toEqual(["a", "b"]);
      expect(new Set(l.body.tasks.map((t: { itemId: string }) => t.itemId)).size).toBe(1);
    }
    expect(c1.body.tasks[0].itemId).not.toBe(c2.body.tasks[0].itemId);

    // Variant b's lease expires: only b is handed out again (a's result is already in).
    const [a, b] = c1.body.tasks;
    await api("POST", `/v1/runs/${run.id}/results`, { results: [{ attemptId: a.attemptId, leaseId: a.leaseId, output: 1 }] });
    await db.update(schema.attempts).set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.attempts.id, b.attemptId));
    const again = await api("POST", `/v1/runs/${run.id}/lease`, { max: 2 });
    expect(again.body.tasks.map((t: { attemptId: string }) => t.attemptId)).toEqual([b.attemptId]);
    await api("POST", `/v1/runs/${run.id}/cancel`);
  });

  it("runs the project's saved variants, or the ones picked by name", async () => {
    const api = sdk(app, apiKey);
    const projectId = (await call("GET", `/portal/orgs/${orgId}/projects`)).body.projects[0].id;
    const base = `/portal/orgs/${orgId}/projects/${projectId}/variants`;

    const gpt = await call("POST", base, { name: "gpt", config: { model: "gpt-5" } });
    expect(gpt.status).toBe(201);
    const claude = (await call("POST", base, { name: "claude", config: { model: "claude-sonnet-5-5" } })).body.variant;
    expect((await call("POST", base, { name: "gpt" })).status).toBe(409);
    const renamed = await call("PATCH", `${base}/${claude.id}`, { config: { model: "claude-sonnet-5-5", prompt: "v3" } });
    expect(renamed.body.variant).toMatchObject({ name: "claude", config: { prompt: "v3" } });
    expect((await call("GET", base)).body.variants.map((v: { name: string }) => v.name)).toEqual(["gpt", "claude"]);

    // No config/variants → every saved variant, with the config as saved right now.
    const all = await api("POST", "/v1/runs", { project: "zebra-solver", dataset: "zebra-puzzles", limit: 1 });
    expect(all.body.variants).toEqual([
      { name: "gpt", config: { model: "gpt-5" } },
      { name: "claude", config: { model: "claude-sonnet-5-5", prompt: "v3" } },
    ]);
    // Pick by name, mixed with an inline one.
    const picked = await api("POST", "/v1/runs", {
      project: "zebra-solver", dataset: "zebra-puzzles", limit: 1, variants: ["claude", { name: "local", config: { model: "llama" } }],
    });
    expect(picked.body.variants.map((v: { name: string }) => v.name)).toEqual(["claude", "local"]);
    const unknown = await api("POST", "/v1/runs", { project: "zebra-solver", dataset: "zebra-puzzles", variants: ["nope"] });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error).toMatchObject({ code: "unknown_variant", details: { available: ["gpt", "claude"] } });
    // `config` still means exactly one variant.
    const single = await api("POST", "/v1/runs", { project: "zebra-solver", dataset: "zebra-puzzles", limit: 1, config: { model: "x" } });
    expect(single.body.variants).toEqual([{ name: "default", config: { model: "x" } }]);

    // Editing a saved variant doesn't change runs that already used it.
    await call("PATCH", `${base}/${gpt.body.variant.id}`, { config: { model: "gpt-6" } });
    const detail = await call("GET", `/portal/orgs/${orgId}/runs/${all.body.number}`);
    expect(detail.body.run.variants[0].config).toEqual({ model: "gpt-5" });

    expect((await call("DELETE", `${base}/${gpt.body.variant.id}`)).status).toBe(200);
    expect((await call("DELETE", `${base}/${claude.id}`)).status).toBe(200);
    for (const r of [all, picked, single]) await api("POST", `/v1/runs/${r.body.id}/cancel`);
  });

  it("edits dataset items in the browser as a new version", async () => {
    const projectId = (await call("GET", `/portal/orgs/${orgId}/projects`)).body.projects[0].id;
    const datasetId = (await call("GET", `/portal/orgs/${orgId}/projects/${projectId}/datasets`)).body.datasets[0].id;
    const base = `/portal/orgs/${orgId}/projects/${projectId}/datasets/${datasetId}`;
    const v2 = (await call("GET", `${base}/versions/2/items`)).body.items;
    const [p1, p2] = v2;

    // Only the latest version can be edited.
    const stale = await call("POST", `${base}/versions/1/edits`, { add: [{ input: 1 }] });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_version");
    expect((await call("POST", `${base}/versions/2/edits`, {})).body.error.code).toBe("no_changes");
    expect((await call("POST", `${base}/versions/2/edits`, { remove: ["00000000-0000-4000-8000-000000000000"] })).body.error.code)
      .toBe("unknown_item");

    const saved = await call("POST", `${base}/versions/2/edits`, {
      remove: [p1.id],
      update: [{ itemId: p2.id, id: "p002", input: { puzzle: "Who owns the turtle?" }, expected: "Gus" }],
      add: [{ id: "p004", input: { puzzle: "Who plays chess?" }, expected: "Ida", metadata: { difficulty: "easy" } }],
    });
    expect(saved.status).toBe(201);
    expect(saved.body.version).toMatchObject({ version: 3, itemCount: 3 });

    const listed = (await call("GET", `/portal/orgs/${orgId}/projects/${projectId}/datasets`)).body.datasets[0];
    expect(listed.latestVersion).toBe(3);
    const project = (await call("GET", `/portal/orgs/${orgId}/projects`)).body.projects[0];
    expect(project.runCount).toBeGreaterThan(5);
    expect(project.lastRunAt).not.toBeNull();

    const v3 = (await call("GET", `${base}/versions/3/items`)).body.items;
    expect(v3.map((i: { externalId: string; position: number; expected: unknown }) => [i.position, i.externalId, i.expected]))
      .toEqual([[0, "p002", "Gus"], [1, "p003", "Cy"], [2, "p004", "Ida"]]);
    expect(v3[1].metadata).toEqual({ difficulty: "hard" }); // untouched items are copied as-is
    // The old version is unchanged.
    expect((await call("GET", `${base}/versions/2/items`)).body.items).toEqual(v2);
  });

  it("keeps organizations isolated and enforces key revocation", async () => {
    const other = portal(app);
    const reg = await other("POST", "/portal/auth/register", { email: "eve@example.com", password: "eve-password-123", name: "Eve" });
    const eveOrg = reg.body.organizations[0].id;
    expect((await other("GET", `/portal/orgs/${orgId}/runs`)).status).toBe(404);
    expect((await call("GET", `/portal/orgs/${eveOrg}`)).status).toBe(404);

    expect((await call("DELETE", `/portal/orgs/${orgId}/api-keys/${keyId}`)).status).toBe(200);
    const res = await sdk(app, apiKey)("GET", "/v1/whoami");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_api_key");
  });

  it("validates requests with a consistent error shape", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/runs", headers: { authorization: "Bearer nope" }, payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("invalid_api_key");
    const bad = await call("POST", "/portal/auth/register", { email: "not-an-email", password: "x", name: "" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("validation_error");
  });

  it("serves the OpenAPI spec", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = res.json();
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(["/v1/runs", "/v1/runs/{runId}/lease", "/v1/runs/{runId}/results"]));
  });
});

describe("stripe webhook", () => {
  it("activates the subscription from Stripe events and rejects bad signatures", async () => {
    const secret = "whsec_test_secret";
    const { app, db } = await setup({
      BILLING_MODE: "stripe", STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: secret, STRIPE_PRICE_ID: "price_123",
    });
    const call = portal(app);
    const reg = await call("POST", "/portal/auth/register", { email: "bo@example.com", password: "bo-password-123", name: "Bo" });
    const orgId = reg.body.organizations[0].id;
    expect((await call("POST", `/portal/orgs/${orgId}/billing/dev-activate`)).status).toBe(404); // not in stripe mode

    const stripe = new Stripe("sk_test_dummy");
    const send = (event: object, sig?: string) => {
      const payload = JSON.stringify(event);
      return app.inject({
        method: "POST", url: "/webhooks/stripe", payload,
        headers: { "content-type": "application/json",
          "stripe-signature": sig ?? stripe.webhooks.generateTestHeaderString({ payload, secret }) },
      });
    };

    expect((await send({ type: "x" }, "t=1,v1=bad")).statusCode).toBe(400);
    await send({ id: "evt_1", object: "event", type: "checkout.session.completed",
      data: { object: { client_reference_id: orgId, customer: "cus_1", subscription: "sub_1" } } });
    await send({ id: "evt_2", object: "event", type: "customer.subscription.updated",
      data: { object: { id: "sub_1", customer: "cus_1", status: "active", metadata: { orgId },
        items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_123", nickname: "Pro" } }] } } } });

    const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.orgId, orgId));
    expect(sub).toMatchObject({ status: "active", plan: "Pro", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" });
  });
});

describe("organization slugs", () => {
  it("never hands out a slug that would shadow a portal page", async () => {
    const { app } = await setup();
    const reg = await portal(app)("POST", "/portal/auth/register", {
      email: "login@example.com", password: "correct-horse-battery", name: "L", organizationName: "Login",
    });
    expect(reg.status).toBe(201);
    expect(reg.body.organizations[0].slug).toBe("login-2");
  });
});
