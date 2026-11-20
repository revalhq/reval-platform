/**
 * Run lifecycle. All execution policy (repeats, timeouts, lease expiry, give-up rules)
 * lives here, so the client packages only have to: lease → call solver → submit.
 *
 *   attempt: pending ──lease──▶ leased ──result──▶ succeeded | errored
 *                 ▲              │ lease expired
 *                 └──────────────┘ (re-leased, up to maxLeases, then → abandoned)
 *
 * A run has one or more variants (configurations under test). Attempts are item × repeat × variant.
 * The attempts of one (item, repeat) — one per variant — form a group that is always leased together,
 * item by item, so every variant of an item executes at the same time under the same conditions.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  attempts, datasetItems, datasets, datasetVersions, projects, projectVariants, runs, runVariants, usageRecords,
} from "../db/schema.js";
import { currentPeriod, HttpError, notFound } from "../lib/http.js";

export type AttemptStatus = (typeof attempts.status.enumValues)[number];
export type Progress = Record<AttemptStatus, number> & { total: number; done: number };

const ALL_STATUSES = attempts.status.enumValues;

export async function progressFor(db: Db, runIds: string[]): Promise<Map<string, Progress>> {
  const out = new Map<string, Progress>();
  if (runIds.length === 0) return out;
  const rows = await db.select({ runId: attempts.runId, status: attempts.status, n: sql<number>`count(*)::int` })
    .from(attempts).where(inArray(attempts.runId, runIds)).groupBy(attempts.runId, attempts.status);
  for (const id of runIds) {
    out.set(id, { ...Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])), total: 0, done: 0 } as Progress);
  }
  for (const r of rows) {
    const p = out.get(r.runId)!;
    p[r.status] = r.n;
    p.total += r.n;
    if (r.status !== "pending" && r.status !== "leased") p.done += r.n;
  }
  return out;
}

export interface CreateRunInput {
  orgId: string;
  apiKeyId?: string;
  project: string;            // project slug
  dataset: string;            // dataset slug
  datasetVersion?: number;    // default: latest
  name?: string;
  config?: Record<string, unknown>;     // single-config shorthand: one variant named "default"
  /** Inline variants, or names of variants saved on the project. Omit both this and `config` to run all saved ones. */
  variants?: (string | { name: string; config?: Record<string, unknown> })[];
  tags?: string[];
  repeats: number;
  timeoutMs: number;
  maxLeases: number;
  limit?: number;             // only the first N items (quick smoke runs)
  trigger?: Record<string, unknown>;
}

export const MAX_VARIANTS = 10;

/**
 * Which configurations a run tests:
 *   `config`            → one variant named "default"
 *   `variants`          → inline { name, config } objects and/or names of variants saved on the project
 *   neither             → every variant saved on the project, or one empty "default" if there are none
 */
async function resolveVariants(db: Db, projectId: string, input: CreateRunInput) {
  if (input.config) return [{ name: "default", config: input.config }];
  const saved = await db.select().from(projectVariants)
    .where(eq(projectVariants.projectId, projectId)).orderBy(projectVariants.position);
  if (!input.variants) {
    return saved.length ? saved.map((v) => ({ name: v.name, config: v.config as Record<string, unknown> }))
      : [{ name: "default", config: {} }];
  }
  const byName = new Map(saved.map((v) => [v.name, v]));
  const unknown = input.variants.filter((v): v is string => typeof v === "string" && !byName.has(v.trim()));
  if (unknown.length) {
    throw new HttpError(422, "unknown_variant",
      `No saved variant named ${unknown.map((n) => `'${n}'`).join(", ")} in this project`,
      { unknown, available: saved.map((v) => v.name) });
  }
  return input.variants.map((v) => {
    if (typeof v !== "string") return v;
    const s = byName.get(v.trim())!;
    return { name: s.name, config: s.config as Record<string, unknown> };
  });
}

export async function createRun(db: Db, input: CreateRunInput) {
  const [project] = await db.select().from(projects)
    .where(and(eq(projects.orgId, input.orgId), eq(projects.slug, input.project)));
  if (!project) throw notFound(`Project '${input.project}'`);

  const [dataset] = await db.select().from(datasets)
    .where(and(eq(datasets.projectId, project.id), eq(datasets.slug, input.dataset)));
  if (!dataset) throw notFound(`Dataset '${input.dataset}' in project '${input.project}'`);

  const versionFilter = input.datasetVersion === undefined
    ? eq(datasetVersions.datasetId, dataset.id)
    : and(eq(datasetVersions.datasetId, dataset.id), eq(datasetVersions.version, input.datasetVersion));
  const [version] = await db.select().from(datasetVersions).where(versionFilter)
    .orderBy(desc(datasetVersions.version)).limit(1);
  if (!version) {
    throw notFound(input.datasetVersion === undefined
      ? `Dataset '${input.dataset}' has no versions yet; upload items first`
      : `Version ${input.datasetVersion} of dataset '${input.dataset}'`);
  }

  const itemCount = Math.min(version.itemCount, input.limit ?? Infinity);
  if (itemCount === 0) throw new HttpError(422, "empty_dataset", "Dataset version has no items");

  if (input.variants && input.config) {
    throw new HttpError(422, "config_and_variants", "Send either `config` or `variants`, not both");
  }
  const variants = (await resolveVariants(db, project.id, input))
    .map((v, position) => ({ name: v.name.trim(), config: v.config ?? {}, position }));
  if (variants.length > MAX_VARIANTS) {
    throw new HttpError(422, "too_many_variants", `A run can compare at most ${MAX_VARIANTS} variants`);
  }
  const names = variants.map((v) => v.name);
  const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  if (dupes.length) {
    throw new HttpError(422, "duplicate_variant", `Variant names must be unique: ${dupes.join(", ")}`, { names: dupes });
  }

  return db.transaction(async (tx) => {
    // Lock the org row so concurrent run creation can't take the same run number.
    await tx.execute(sql`SELECT id FROM organizations WHERE id = ${input.orgId} FOR UPDATE`);
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${runs.number}), 0)::int + 1` })
      .from(runs).where(eq(runs.orgId, input.orgId)) as [{ next: number }];
    const [run] = await tx.insert(runs).values({
      number: next, orgId: input.orgId, projectId: project.id, datasetVersionId: version.id,
      name: input.name, config: variants.length === 1 ? variants[0]!.config : {}, tags: input.tags ?? [],
      repeats: input.repeats, timeoutMs: input.timeoutMs, maxLeases: input.maxLeases,
      totalAttempts: itemCount * input.repeats * variants.length, trigger: input.trigger ?? {}, apiKeyId: input.apiKeyId,
    }).returning();

    const createdVariants = await tx.insert(runVariants)
      .values(variants.map((v) => ({ ...v, runId: run!.id }))).returning();

    // One attempt per (item, repeat, variant), created in a single statement.
    await tx.execute(sql`
      INSERT INTO attempts (run_id, item_id, repeat_index, variant_id)
      SELECT ${run!.id}, i.id, r.n, v.id
      FROM dataset_items i
        CROSS JOIN generate_series(0, ${input.repeats - 1}) AS r(n)
        CROSS JOIN run_variants v
      WHERE i.version_id = ${version.id} AND i.position < ${itemCount} AND v.run_id = ${run!.id}`);

    return { run: run!, project, dataset, version, variants: createdVariants.sort((a, b) => a.position - b.position) };
  });
}

export type RunVariant = typeof runVariants.$inferSelect;

/** Variants of the given runs, in position order. */
export async function variantsFor(db: Db, runIds: string[]): Promise<Map<string, RunVariant[]>> {
  const out = new Map<string, RunVariant[]>(runIds.map((id) => [id, []]));
  if (runIds.length === 0) return out;
  const rows = await db.select().from(runVariants).where(inArray(runVariants.runId, runIds))
    .orderBy(runVariants.runId, runVariants.position);
  for (const v of rows) out.get(v.runId)!.push(v);
  return out;
}

export interface VariantStats {
  variantId: string;
  progress: Progress;
  latencyP50: number | null;
  latencyP95: number | null;
  /** Sums of numeric client metadata (tokens, cost...) over finished attempts, with how many reported it. */
  metadataTotals: Record<string, { sum: number; count: number }>;
}

/** Per-variant progress, latency and metadata totals, for comparing configurations side by side. */
export async function variantStats(db: Db, runId: string): Promise<VariantStats[]> {
  const variants = (await variantsFor(db, [runId])).get(runId)!;
  const [statusRows, latencyRows, metaRows] = await Promise.all([
    db.select({ variantId: attempts.variantId, status: attempts.status, n: sql<number>`count(*)::int` })
      .from(attempts).where(eq(attempts.runId, runId)).groupBy(attempts.variantId, attempts.status),
    db.select({
      variantId: attempts.variantId,
      p50: sql<number | null>`percentile_cont(0.5) within group (order by ${attempts.latencyMs})`,
      p95: sql<number | null>`percentile_cont(0.95) within group (order by ${attempts.latencyMs})`,
    }).from(attempts).where(and(eq(attempts.runId, runId), eq(attempts.status, "succeeded")))
      .groupBy(attempts.variantId),
    db.execute(sql`
      SELECT a.variant_id, m.key, sum((m.value)::text::numeric)::float8 AS sum, count(*)::int AS count
      FROM attempts a CROSS JOIN LATERAL jsonb_each(a.metadata) AS m(key, value)
      WHERE a.run_id = ${runId} AND a.status IN ('succeeded', 'errored') AND jsonb_typeof(m.value) = 'number'
      GROUP BY a.variant_id, m.key`),
  ]);

  const stats = new Map<string, VariantStats>(variants.map((v) => [v.id, {
    variantId: v.id,
    progress: { ...Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])), total: 0, done: 0 } as Progress,
    latencyP50: null, latencyP95: null, metadataTotals: {},
  }]));
  for (const r of statusRows) {
    const p = stats.get(r.variantId)!.progress;
    p[r.status] = r.n;
    p.total += r.n;
    if (r.status !== "pending" && r.status !== "leased") p.done += r.n;
  }
  for (const r of latencyRows) {
    const s = stats.get(r.variantId)!;
    s.latencyP50 = r.p50 === null ? null : Number(r.p50);
    s.latencyP95 = r.p95 === null ? null : Number(r.p95);
  }
  for (const r of (metaRows as unknown as { rows: { variant_id: string; key: string; sum: number; count: number }[] }).rows) {
    stats.get(r.variant_id)!.metadataTotals[r.key] = { sum: Number(r.sum), count: Number(r.count) };
  }
  return [...stats.values()];
}

export async function getOrgRun(db: Db, orgId: string, runId: string) {
  const [run] = await db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.orgId, orgId)));
  if (!run) throw notFound("Run");
  return run;
}

export interface LeasedTask {
  attemptId: string;
  leaseId: string;
  leaseExpiresAt: Date;
  itemId: string;
  repeatIndex: number;
  variant: string;
  config: Record<string, unknown>;
  input: unknown;
}

/**
 * Leases whole (item, repeat) groups — every outstanding variant of an item at once — so the client
 * can run them side by side. Returns tasks for floor(max / variants) groups, but always at least one
 * group, so a run with more variants than `max` can still make progress.
 */
export async function leaseTasks(db: Db, orgId: string, runId: string, max: number, leaseGraceMs: number) {
  const run = await getOrgRun(db, orgId, runId);
  if (run.status === "cancelled" || run.status === "completed") {
    return { run, tasks: [] as LeasedTask[], outstanding: 0 };
  }
  const leaseSeconds = (run.timeoutMs + leaseGraceMs) / 1000;
  const [{ variantCount }] = await db.select({ variantCount: sql<number>`count(*)::int` })
    .from(runVariants).where(eq(runVariants.runId, runId)) as [{ variantCount: number }];
  const maxGroups = Math.max(1, Math.floor(max / Math.max(1, variantCount)));

  const tasks = await db.transaction(async (tx) => {
    // Serialize leasing within this run so two clients never split one item's group between them.
    // Leasing is a short statement; clients working other runs are unaffected.
    await tx.execute(sql`SELECT id FROM runs WHERE id = ${runId} FOR UPDATE`);

    // Attempts whose lease expired too many times are given up on.
    await tx.execute(sql`
      UPDATE attempts SET status = 'abandoned', lease_id = NULL, completed_at = now(),
        error = 'No result received after ' || lease_count || ' lease(s)'
      WHERE run_id = ${runId} AND status = 'leased' AND lease_expires_at < now()
        AND lease_count >= ${run.maxLeases}`);

    // Pick the next groups in (repeat, item) order, then lease every available attempt in them.
    // An attempt is available when pending, or leased with an expired lease.
    const result = await tx.execute(sql`
      WITH available AS (
        SELECT a.id, a.item_id, a.repeat_index FROM attempts a
        WHERE a.run_id = ${runId}
          AND (a.status = 'pending' OR (a.status = 'leased' AND a.lease_expires_at < now()))
      ),
      groups AS (
        SELECT av.item_id, av.repeat_index, min(i.position) AS position
        FROM available av JOIN dataset_items i ON i.id = av.item_id
        GROUP BY av.item_id, av.repeat_index
        ORDER BY av.repeat_index, min(i.position)
        LIMIT ${maxGroups}
      ),
      picked AS (
        SELECT a.id FROM attempts a
        JOIN available av ON av.id = a.id
        JOIN groups g ON g.item_id = av.item_id AND g.repeat_index = av.repeat_index
        FOR UPDATE OF a SKIP LOCKED
      )
      UPDATE attempts a SET status = 'leased', lease_id = gen_random_uuid(), leased_at = now(),
        lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
        lease_count = a.lease_count + 1
      FROM picked, dataset_items i, run_variants v
      WHERE a.id = picked.id AND i.id = a.item_id AND v.id = a.variant_id
      RETURNING a.id, a.lease_id, a.lease_expires_at, a.repeat_index, i.id AS item_id,
        i.external_id, i.input, i.position, v.name AS variant, v.config, v.position AS variant_position`);

    const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
    if (rows.length > 0 || run.status === "queued") {
      await tx.update(runs).set({
        status: "running",
        startedAt: run.startedAt ?? new Date(),
        lastActivityAt: new Date(),
      }).where(and(eq(runs.id, runId), inArray(runs.status, ["queued", "running"])));
    }
    return rows
      .sort((a, b) => Number(a.repeat_index) - Number(b.repeat_index) || Number(a.position) - Number(b.position)
        || Number(a.variant_position) - Number(b.variant_position))
      .map((r): LeasedTask => ({
        attemptId: String(r.id),
        leaseId: String(r.lease_id),
        leaseExpiresAt: new Date(r.lease_expires_at as string),
        itemId: (r.external_id as string | null) ?? String(r.item_id),
        repeatIndex: Number(r.repeat_index),
        variant: String(r.variant),
        config: (r.config ?? {}) as Record<string, unknown>,
        input: r.input,
      }));
  });

  await finalizeIfDone(db, runId); // abandoning may have finished the run
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(attempts)
    .where(and(eq(attempts.runId, runId), inArray(attempts.status, ["pending", "leased"]))) as [{ n: number }];
  const [fresh] = await db.select().from(runs).where(eq(runs.id, runId));
  return { run: fresh!, tasks, outstanding: n };
}

export interface ResultInput {
  attemptId: string;
  leaseId: string;
  output?: unknown;
  error?: string;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}

export async function submitResults(db: Db, orgId: string, runId: string, results: ResultInput[]) {
  const run = await getOrgRun(db, orgId, runId);
  const accepted: string[] = [];
  const rejected: { attemptId: string; reason: string }[] = [];

  if (run.status === "cancelled") {
    return { run, accepted, rejected: results.map((r) => ({ attemptId: r.attemptId, reason: "run_cancelled" })) };
  }

  await db.transaction(async (tx) => {
    for (const r of results) {
      const isError = r.error !== undefined && r.error !== null;
      // The lease id must match: a late result from an expired, re-leased attempt is rejected,
      // so each attempt has exactly one recorded outcome.
      const updated = await tx.update(attempts).set({
        status: isError ? "errored" : "succeeded",
        output: isError ? null : (r.output ?? null),
        error: isError ? r.error!.slice(0, 4000) : null,
        latencyMs: r.latencyMs ?? null,
        metadata: r.metadata ?? {},
        completedAt: new Date(),
        leaseId: null,
        leaseExpiresAt: null,
      }).where(and(
        eq(attempts.id, r.attemptId), eq(attempts.runId, runId),
        eq(attempts.leaseId, r.leaseId), eq(attempts.status, "leased"),
      )).returning({ id: attempts.id });
      if (updated.length) accepted.push(r.attemptId);
      else rejected.push({ attemptId: r.attemptId, reason: "unknown_attempt_or_stale_lease" });
    }
    if (accepted.length) {
      await tx.insert(usageRecords).values({ orgId, period: currentPeriod(), attemptsSubmitted: accepted.length })
        .onConflictDoUpdate({
          target: [usageRecords.orgId, usageRecords.period],
          set: { attemptsSubmitted: sql`${usageRecords.attemptsSubmitted} + ${accepted.length}` },
        });
      await tx.update(runs).set({ lastActivityAt: new Date() }).where(eq(runs.id, runId));
    }
  });

  await finalizeIfDone(db, runId);
  const [fresh] = await db.select().from(runs).where(eq(runs.id, runId));
  return { run: fresh!, accepted, rejected };
}

/** Marks a running run completed once nothing is pending or leased. Safe to call repeatedly. */
export async function finalizeIfDone(db: Db, runId: string) {
  await db.execute(sql`
    UPDATE runs SET status = 'completed', finished_at = now()
    WHERE id = ${runId} AND status = 'running'
      AND NOT EXISTS (SELECT 1 FROM attempts
                      WHERE run_id = ${runId} AND status IN ('pending', 'leased'))`);
}

export async function cancelRun(db: Db, orgId: string, runId: string) {
  const run = await getOrgRun(db, orgId, runId);
  if (run.status === "completed" || run.status === "cancelled") {
    throw new HttpError(409, "run_finished", `Run is already ${run.status}`);
  }
  await db.transaction(async (tx) => {
    await tx.update(runs).set({ status: "cancelled", finishedAt: new Date() }).where(eq(runs.id, runId));
    await tx.update(attempts).set({ status: "cancelled", leaseId: null, leaseExpiresAt: null })
      .where(and(eq(attempts.runId, runId), inArray(attempts.status, ["pending", "leased"])));
  });
  return getOrgRun(db, orgId, runId);
}
