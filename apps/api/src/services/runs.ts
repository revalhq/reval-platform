/**
 * Run lifecycle. All execution policy (repeats, timeouts, lease expiry, give-up rules)
 * lives here, so the client packages only have to: lease → call solver → submit.
 *
 *   attempt: pending ──lease──▶ leased ──result──▶ succeeded | errored
 *                 ▲              │ lease expired
 *                 └──────────────┘ (re-leased, up to maxLeases, then → abandoned)
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { attempts, datasetItems, datasets, datasetVersions, projects, runs, usageRecords } from "../db/schema.js";
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
  config?: Record<string, unknown>;
  tags?: string[];
  repeats: number;
  timeoutMs: number;
  maxLeases: number;
  limit?: number;             // only the first N items (quick smoke runs)
  trigger?: Record<string, unknown>;
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

  return db.transaction(async (tx) => {
    // Lock the org row so concurrent run creation can't take the same run number.
    await tx.execute(sql`SELECT id FROM organizations WHERE id = ${input.orgId} FOR UPDATE`);
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${runs.number}), 0)::int + 1` })
      .from(runs).where(eq(runs.orgId, input.orgId)) as [{ next: number }];
    const [run] = await tx.insert(runs).values({
      number: next, orgId: input.orgId, projectId: project.id, datasetVersionId: version.id,
      name: input.name, config: input.config ?? {}, tags: input.tags ?? [],
      repeats: input.repeats, timeoutMs: input.timeoutMs, maxLeases: input.maxLeases,
      totalAttempts: itemCount * input.repeats, trigger: input.trigger ?? {}, apiKeyId: input.apiKeyId,
    }).returning();

    // One attempt per (item, repeat), created in a single statement.
    await tx.execute(sql`
      INSERT INTO attempts (run_id, item_id, repeat_index)
      SELECT ${run!.id}, i.id, r.n
      FROM dataset_items i CROSS JOIN generate_series(0, ${input.repeats - 1}) AS r(n)
      WHERE i.version_id = ${version.id} AND i.position < ${itemCount}`);

    return { run: run!, project, dataset, version };
  });
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
  input: unknown;
}

export async function leaseTasks(db: Db, orgId: string, runId: string, max: number, leaseGraceMs: number) {
  const run = await getOrgRun(db, orgId, runId);
  if (run.status === "cancelled" || run.status === "completed") {
    return { run, tasks: [] as LeasedTask[], outstanding: 0 };
  }
  const leaseSeconds = (run.timeoutMs + leaseGraceMs) / 1000;

  const tasks = await db.transaction(async (tx) => {
    // Attempts whose lease expired too many times are given up on.
    await tx.execute(sql`
      UPDATE attempts SET status = 'abandoned', lease_id = NULL, completed_at = now(),
        error = 'No result received after ' || lease_count || ' lease(s)'
      WHERE run_id = ${runId} AND status = 'leased' AND lease_expires_at < now()
        AND lease_count >= ${run.maxLeases}`);

    // Grab pending (or expired) attempts without blocking other clients working the same run.
    const result = await tx.execute(sql`
      WITH picked AS (
        SELECT a.id FROM attempts a JOIN dataset_items i ON i.id = a.item_id
        WHERE a.run_id = ${runId}
          AND (a.status = 'pending' OR (a.status = 'leased' AND a.lease_expires_at < now()))
        ORDER BY a.repeat_index, i.position
        LIMIT ${max}
        FOR UPDATE OF a SKIP LOCKED
      )
      UPDATE attempts a SET status = 'leased', lease_id = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
        lease_count = a.lease_count + 1
      FROM picked, dataset_items i
      WHERE a.id = picked.id AND i.id = a.item_id
      RETURNING a.id, a.lease_id, a.lease_expires_at, a.repeat_index, i.id AS item_id,
        i.external_id, i.input, i.position`);

    const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
    if (rows.length > 0 || run.status === "queued") {
      await tx.update(runs).set({
        status: "running",
        startedAt: run.startedAt ?? new Date(),
        lastActivityAt: new Date(),
      }).where(and(eq(runs.id, runId), inArray(runs.status, ["queued", "running"])));
    }
    return rows
      .sort((a, b) => Number(a.repeat_index) - Number(b.repeat_index) || Number(a.position) - Number(b.position))
      .map((r): LeasedTask => ({
        attemptId: String(r.id),
        leaseId: String(r.lease_id),
        leaseExpiresAt: new Date(r.lease_expires_at as string),
        itemId: (r.external_id as string | null) ?? String(r.item_id),
        repeatIndex: Number(r.repeat_index),
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
