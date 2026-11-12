import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  attempts, datasetItems, datasets, datasetVersions, projects, runs, users,
} from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { conflict, HttpError, notFound, slugify } from "../../lib/http.js";
import { requireOrgRole } from "../../plugins/auth.js";
import { cancelRun, getOrgRun, progressFor } from "../../services/runs.js";

const OrgParams = z.object({ orgId: z.uuid() });
const ProjectParams = OrgParams.extend({ projectId: z.uuid() });
const DatasetParams = ProjectParams.extend({ datasetId: z.uuid() });
const RunParams = OrgParams.extend({ runNumber: z.coerce.number().int().positive() });

const MAX_ITEMS_PER_VERSION = 50_000;
const ItemSchema = z.object({
  id: z.string().max(200).optional(),
  input: z.unknown().refine((v) => v !== undefined, "input is required"),
  expected: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Accepts a JSON body { items: [...] } or a JSONL body (one item per line). */
function parseItems(body: unknown): z.infer<typeof ItemSchema>[] {
  let raw: unknown[];
  if (typeof body === "string") {
    raw = [];
    const lines = body.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      try { raw.push(JSON.parse(line)); } catch {
        throw new HttpError(400, "invalid_jsonl", `Line ${i + 1} is not valid JSON`);
      }
    });
  } else if (body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)) {
    raw = (body as { items: unknown[] }).items;
  } else {
    throw new HttpError(400, "invalid_body", "Send { items: [...] } as JSON, or JSONL with content-type application/x-ndjson");
  }
  if (raw.length === 0) throw new HttpError(422, "empty_dataset", "No items supplied");
  if (raw.length > MAX_ITEMS_PER_VERSION) {
    throw new HttpError(413, "too_many_items", `At most ${MAX_ITEMS_PER_VERSION} items per version`);
  }
  return raw.map((item, i) => {
    const parsed = ItemSchema.safeParse(item);
    if (!parsed.success) {
      throw new HttpError(422, "invalid_item", `Item ${i + 1}: ${parsed.error.issues[0]?.message}`, parsed.error.issues);
    }
    return parsed.data;
  });
}

export const projectRoutes: FastifyPluginAsyncZod = async (app) => {
  // JSONL uploads arrive as plain strings.
  app.addContentTypeParser(["application/x-ndjson", "application/jsonl", "text/plain"],
    { parseAs: "string", bodyLimit: 50 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  async function projectInOrg(orgId: string, projectId: string) {
    const [p] = await app.db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));
    if (!p) throw notFound("Project");
    return p;
  }
  async function datasetInProject(projectId: string, datasetId: string) {
    const [d] = await app.db.select().from(datasets).where(and(eq(datasets.id, datasetId), eq(datasets.projectId, projectId)));
    if (!d) throw notFound("Dataset");
    return d;
  }

  // ------------------------------------------------------------ projects

  const pTags = ["Portal: projects"];

  app.get("/:orgId/projects", {
    schema: { tags: pTags, summary: "List projects", params: OrgParams }, preHandler: requireOrgRole(),
  }, async (req) => ({
    projects: await app.db.select({
      id: projects.id, name: projects.name, slug: projects.slug, createdAt: projects.createdAt,
      runCount: sql<number>`(select count(*)::int from runs r where r.project_id = ${projects.id})`,
      lastRunAt: sql<string | null>`(select max(r.created_at) from runs r where r.project_id = ${projects.id})`,
    }).from(projects).where(eq(projects.orgId, req.params.orgId)).orderBy(asc(projects.name)),
  }));

  app.post("/:orgId/projects", {
    schema: {
      tags: pTags, summary: "Create a project", params: OrgParams,
      body: z.object({ name: z.string().min(1).max(100), slug: z.string().regex(/^[a-z0-9-]{1,60}$/).optional() }),
    },
    preHandler: requireOrgRole("admin"),
  }, async (req, reply) => {
    const slug = req.body.slug ?? slugify(req.body.name);
    const [dupe] = await app.db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.orgId, req.params.orgId), eq(projects.slug, slug)));
    if (dupe) throw conflict(`A project with slug '${slug}' already exists`);
    const [p] = await app.db.insert(projects).values({ orgId: req.params.orgId, name: req.body.name, slug }).returning();
    await audit(req, req.params.orgId, "project.created", p!.id, { slug });
    reply.code(201);
    return { project: p! };
  });

  // ------------------------------------------------------------ datasets

  const dTags = ["Portal: datasets"];

  app.get("/:orgId/projects/:projectId/datasets", {
    schema: { tags: dTags, summary: "List datasets", params: ProjectParams }, preHandler: requireOrgRole(),
  }, async (req) => {
    await projectInOrg(req.params.orgId, req.params.projectId);
    return {
      datasets: await app.db.select({
        id: datasets.id, name: datasets.name, slug: datasets.slug, description: datasets.description,
        createdAt: datasets.createdAt,
        latestVersion: sql<number | null>`(select max(v.version) from dataset_versions v where v.dataset_id = ${datasets.id})`,
      }).from(datasets).where(eq(datasets.projectId, req.params.projectId)).orderBy(asc(datasets.name)),
    };
  });

  app.post("/:orgId/projects/:projectId/datasets", {
    schema: {
      tags: dTags, summary: "Create a dataset", params: ProjectParams,
      body: z.object({
        name: z.string().min(1).max(100),
        slug: z.string().regex(/^[a-z0-9-]{1,60}$/).optional(),
        description: z.string().max(2000).optional(),
      }),
    },
    preHandler: requireOrgRole("admin"),
  }, async (req, reply) => {
    await projectInOrg(req.params.orgId, req.params.projectId);
    const slug = req.body.slug ?? slugify(req.body.name);
    const [dupe] = await app.db.select({ id: datasets.id }).from(datasets)
      .where(and(eq(datasets.projectId, req.params.projectId), eq(datasets.slug, slug)));
    if (dupe) throw conflict(`A dataset with slug '${slug}' already exists in this project`);
    const [d] = await app.db.insert(datasets).values({
      projectId: req.params.projectId, name: req.body.name, slug, description: req.body.description,
    }).returning();
    reply.code(201);
    return { dataset: d! };
  });

  app.get("/:orgId/projects/:projectId/datasets/:datasetId", {
    schema: { tags: dTags, summary: "Dataset with its versions", params: DatasetParams }, preHandler: requireOrgRole(),
  }, async (req) => {
    await projectInOrg(req.params.orgId, req.params.projectId);
    const dataset = await datasetInProject(req.params.projectId, req.params.datasetId);
    const versions = await app.db.select({
      id: datasetVersions.id, version: datasetVersions.version, itemCount: datasetVersions.itemCount,
      createdAt: datasetVersions.createdAt, createdBy: users.name,
    }).from(datasetVersions).leftJoin(users, eq(users.id, datasetVersions.createdBy))
      .where(eq(datasetVersions.datasetId, dataset.id)).orderBy(desc(datasetVersions.version));
    return { dataset, versions };
  });

  app.post("/:orgId/projects/:projectId/datasets/:datasetId/versions", {
    schema: {
      tags: dTags, summary: "Upload a new dataset version",
      description: "Body: JSON { items: [{ id?, input, expected?, metadata? }] } or JSONL with one item per line. Versions are immutable.",
      params: DatasetParams,
    },
    bodyLimit: 50 * 1024 * 1024,
    preHandler: requireOrgRole("admin"),
  }, async (req, reply) => {
    await projectInOrg(req.params.orgId, req.params.projectId);
    const dataset = await datasetInProject(req.params.projectId, req.params.datasetId);
    const items = parseItems(req.body);

    const version = await app.db.transaction(async (tx) => {
      // Lock the dataset row so two uploads can't claim the same version number.
      await tx.execute(sql`SELECT id FROM datasets WHERE id = ${dataset.id} FOR UPDATE`);
      const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${datasetVersions.version}), 0)::int + 1` })
        .from(datasetVersions).where(eq(datasetVersions.datasetId, dataset.id)) as [{ next: number }];
      const [v] = await tx.insert(datasetVersions).values({
        datasetId: dataset.id, version: next, itemCount: items.length, createdBy: req.user!.id,
      }).returning();
      for (let i = 0; i < items.length; i += 1000) {
        await tx.insert(datasetItems).values(items.slice(i, i + 1000).map((it, j) => ({
          versionId: v!.id, position: i + j, externalId: it.id ?? null,
          input: it.input as object, expected: (it.expected ?? null) as object | null, metadata: it.metadata ?? {},
        })));
      }
      return v!;
    });
    await audit(req, req.params.orgId, "dataset.version_created", dataset.id,
      { version: version.version, items: items.length });
    reply.code(201);
    return { version };
  });

  app.get("/:orgId/projects/:projectId/datasets/:datasetId/versions/:version/items", {
    schema: {
      tags: dTags, summary: "Browse items of a dataset version",
      params: DatasetParams.extend({ version: z.coerce.number().int().positive() }),
      querystring: z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(50) }),
    },
    preHandler: requireOrgRole(),
  }, async (req) => {
    await projectInOrg(req.params.orgId, req.params.projectId);
    const dataset = await datasetInProject(req.params.projectId, req.params.datasetId);
    const [v] = await app.db.select().from(datasetVersions)
      .where(and(eq(datasetVersions.datasetId, dataset.id), eq(datasetVersions.version, req.params.version)));
    if (!v) throw notFound("Dataset version");
    const items = await app.db.select().from(datasetItems).where(eq(datasetItems.versionId, v.id))
      .orderBy(asc(datasetItems.position)).offset(req.query.offset).limit(req.query.limit);
    return { version: v, items, total: v.itemCount };
  });

  // ------------------------------------------------------------ runs (the pipeline view)

  const rTags = ["Portal: runs"];
  const runColumns = {
    id: runs.id, number: runs.number, name: runs.name, status: runs.status, config: runs.config, tags: runs.tags,
    repeats: runs.repeats, timeoutMs: runs.timeoutMs, totalAttempts: runs.totalAttempts, trigger: runs.trigger,
    createdAt: runs.createdAt, startedAt: runs.startedAt, finishedAt: runs.finishedAt, lastActivityAt: runs.lastActivityAt,
    project: { id: projects.id, name: projects.name, slug: projects.slug },
    dataset: { id: datasets.id, name: datasets.name, slug: datasets.slug, version: datasetVersions.version },
  };
  const runBase = () => app.db.select(runColumns).from(runs)
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .innerJoin(datasetVersions, eq(datasetVersions.id, runs.datasetVersionId))
    .innerJoin(datasets, eq(datasets.id, datasetVersions.datasetId));

  app.get("/:orgId/runs", {
    schema: {
      tags: rTags, summary: "List runs, newest first",
      description: "Paginate with `before` = the smallest run number from the previous page.",
      params: OrgParams,
      querystring: z.object({
        projectId: z.uuid().optional(),
        status: z.enum(["queued", "running", "completed", "cancelled"]).optional(),
        before: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      }),
    },
    preHandler: requireOrgRole(),
  }, async (req) => {
    const q = req.query;
    const rows = await runBase().where(and(
      eq(runs.orgId, req.params.orgId),
      q.projectId ? eq(runs.projectId, q.projectId) : undefined,
      q.status ? eq(runs.status, q.status) : undefined,
      q.before ? lt(runs.number, q.before) : undefined,
    )).orderBy(desc(runs.number)).limit(q.limit);
    const progress = await progressFor(app.db, rows.map((r) => r.id));
    return {
      runs: rows.map((r) => ({ ...r, progress: progress.get(r.id) })),
      nextBefore: rows.length === q.limit ? rows[rows.length - 1]!.number : null,
    };
  });

  app.get("/:orgId/runs/:runNumber", {
    schema: { tags: rTags, summary: "Run detail", params: RunParams }, preHandler: requireOrgRole(),
  }, async (req) => {
    const [run] = await runBase().where(and(eq(runs.orgId, req.params.orgId), eq(runs.number, req.params.runNumber)));
    if (!run) throw notFound("Run");
    const [stats] = await app.db.select({
      latencyP50: sql<number | null>`percentile_cont(0.5) within group (order by ${attempts.latencyMs})`,
      latencyP95: sql<number | null>`percentile_cont(0.95) within group (order by ${attempts.latencyMs})`,
    }).from(attempts).where(and(eq(attempts.runId, run.id), eq(attempts.status, "succeeded")));
    return { run: { ...run, progress: (await progressFor(app.db, [run.id])).get(run.id) }, stats };
  });

  app.get("/:orgId/runs/:runNumber/attempts", {
    schema: {
      tags: rTags, summary: "Attempts of a run, with inputs, outputs and expected values",
      params: RunParams,
      querystring: z.object({
        status: z.enum(["pending", "leased", "succeeded", "errored", "abandoned", "cancelled"]).optional(),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
    },
    preHandler: requireOrgRole(),
  }, async (req) => {
    const [run] = await app.db.select({ id: runs.id }).from(runs)
      .where(and(eq(runs.orgId, req.params.orgId), eq(runs.number, req.params.runNumber)));
    if (!run) throw notFound("Run");
    const where = and(eq(attempts.runId, run.id), req.query.status ? eq(attempts.status, req.query.status) : undefined);
    const rows = await app.db.select({
      id: attempts.id, status: attempts.status, repeatIndex: attempts.repeatIndex, leaseCount: attempts.leaseCount,
      output: attempts.output, error: attempts.error, latencyMs: attempts.latencyMs, metadata: attempts.metadata,
      completedAt: attempts.completedAt,
      item: { id: datasetItems.id, externalId: datasetItems.externalId, position: datasetItems.position,
              input: datasetItems.input, expected: datasetItems.expected },
    }).from(attempts).innerJoin(datasetItems, eq(datasetItems.id, attempts.itemId))
      .where(where).orderBy(asc(datasetItems.position), asc(attempts.repeatIndex))
      .offset(req.query.offset).limit(req.query.limit);
    const [{ total }] = await app.db.select({ total: sql<number>`count(*)::int` }).from(attempts).where(where) as [{ total: number }];
    return { attempts: rows, total };
  });

  app.post("/:orgId/runs/:runNumber/cancel", {
    schema: { tags: rTags, summary: "Cancel a queued or running run", params: RunParams },
    preHandler: requireOrgRole(),
  }, async (req) => {
    const [row] = await app.db.select({ id: runs.id }).from(runs)
      .where(and(eq(runs.orgId, req.params.orgId), eq(runs.number, req.params.runNumber)));
    if (!row) throw notFound("Run");
    const run = await cancelRun(app.db, req.params.orgId, row.id);
    await audit(req, req.params.orgId, "run.cancelled", run.id, { number: run.number });
    return { run: await getOrgRun(app.db, req.params.orgId, run.id) };
  });
};
