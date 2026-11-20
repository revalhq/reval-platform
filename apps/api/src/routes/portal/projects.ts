import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  attempts, datasetItems, datasets, datasetVersions, projects, projectVariants, runs, runVariants, users,
} from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { conflict, HttpError, notFound, slugify } from "../../lib/http.js";
import { requireOrgRole } from "../../plugins/auth.js";
import type { Db } from "../../db/client.js";
import {
  cancelRun, getOrgRun, MAX_VARIANTS, progressFor, variantsFor, variantStats,
} from "../../services/runs.js";

const OrgParams = z.object({ orgId: z.uuid() });
const ProjectParams = OrgParams.extend({ projectId: z.uuid() });
const DatasetParams = ProjectParams.extend({ datasetId: z.uuid() });
const RunParams = OrgParams.extend({ runNumber: z.coerce.number().int().positive() });
const VariantParams = ProjectParams.extend({ variantId: z.uuid() });
const VariantBody = z.object({
  name: z.string().trim().min(1).max(50),
  config: z.record(z.string(), z.unknown()).default({}),
});

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

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Next version number for a dataset; locks the dataset row so concurrent writers can't take the same one. */
async function insertVersion(tx: Tx, datasetId: string, itemCount: number, userId: string) {
  await tx.execute(sql`SELECT id FROM datasets WHERE id = ${datasetId} FOR UPDATE`);
  const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${datasetVersions.version}), 0)::int + 1` })
    .from(datasetVersions).where(eq(datasetVersions.datasetId, datasetId)) as [{ next: number }];
  const [v] = await tx.insert(datasetVersions).values({ datasetId, version: next, itemCount, createdBy: userId }).returning();
  return v!;
}

async function insertItems(tx: Tx, versionId: string, items: z.infer<typeof ItemSchema>[], startPosition = 0) {
  for (let i = 0; i < items.length; i += 1000) {
    await tx.insert(datasetItems).values(items.slice(i, i + 1000).map((it, j) => ({
      versionId, position: startPosition + i + j, externalId: it.id ?? null,
      input: it.input as object, expected: (it.expected ?? null) as object | null, metadata: it.metadata ?? {},
    })));
  }
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
      // Correlated subqueries name the outer table explicitly: drizzle renders ${projects.id} as a bare "id"
      // here, which Postgres would resolve to the subquery's own r.id.
      runCount: sql<number>`(select count(*)::int from runs r where r.project_id = "projects"."id")`,
      lastRunAt: sql<string | null>`(select max(r.created_at) from runs r where r.project_id = "projects"."id")`,
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
        latestVersion: sql<number | null>`(select max(v.version) from dataset_versions v where v.dataset_id = "datasets"."id")`,
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
      const v = await insertVersion(tx, dataset.id, items.length, req.user!.id);
      await insertItems(tx, v.id, items);
      return v;
    });
    await audit(req, req.params.orgId, "dataset.version_created", dataset.id,
      { version: version.version, items: items.length });
    reply.code(201);
    return { version };
  });

  app.post("/:orgId/projects/:projectId/datasets/:datasetId/versions/:version/edits", {
    schema: {
      tags: dTags, summary: "Create a new version by editing items of the latest one",
      description: [
        "Copies `version` (which must be the latest) with the changes applied, as a new immutable version.",
        "`update` replaces whole items (by their item uuid, keeping their position), `remove` drops items,",
        "`add` appends new ones at the end.",
      ].join(" "),
      params: DatasetParams.extend({ version: z.coerce.number().int().positive() }),
      body: z.object({
        add: z.array(ItemSchema).max(MAX_ITEMS_PER_VERSION).default([]),
        update: z.array(ItemSchema.extend({ itemId: z.uuid() })).max(MAX_ITEMS_PER_VERSION).default([]),
        remove: z.array(z.uuid()).max(MAX_ITEMS_PER_VERSION).default([]),
      }),
    },
    preHandler: requireOrgRole("admin"),
  }, async (req, reply) => {
    await projectInOrg(req.params.orgId, req.params.projectId);
    const dataset = await datasetInProject(req.params.projectId, req.params.datasetId);
    const { add, update, remove } = req.body;
    if (add.length + update.length + remove.length === 0) {
      throw new HttpError(422, "no_changes", "Nothing to save: add, update or remove at least one item");
    }
    const removed = new Set(remove);
    const updatedIds = update.map((u) => u.itemId);
    if (new Set(updatedIds).size !== updatedIds.length) {
      throw new HttpError(422, "duplicate_update", "Each item can be updated at most once per edit");
    }
    if (updatedIds.some((id) => removed.has(id))) {
      throw new HttpError(422, "update_and_remove", "An item can't be both updated and removed");
    }

    const version = await app.db.transaction(async (tx) => {
      const [base] = await tx.select().from(datasetVersions)
        .where(and(eq(datasetVersions.datasetId, dataset.id), eq(datasetVersions.version, req.params.version)));
      if (!base) throw notFound("Dataset version");

      const touched = [...removed, ...updatedIds];
      if (touched.length) {
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(datasetItems)
          .where(and(eq(datasetItems.versionId, base.id),
            sql`${datasetItems.id}::text IN (SELECT jsonb_array_elements_text(${JSON.stringify(touched)}::jsonb))`)) as [{ n: number }];
        if (n !== touched.length) {
          throw new HttpError(422, "unknown_item", `Some edited items are not in version ${base.version}`);
        }
      }
      const kept = base.itemCount - removed.size;
      if (kept + add.length === 0) throw new HttpError(422, "empty_dataset", "A version needs at least one item");
      if (kept + add.length > MAX_ITEMS_PER_VERSION) {
        throw new HttpError(413, "too_many_items", `At most ${MAX_ITEMS_PER_VERSION} items per version`);
      }

      const v = await insertVersion(tx, dataset.id, kept + add.length, req.user!.id);
      // insertVersion locked the dataset, so "latest" can't change under us from here on.
      if (v.version !== base.version + 1) {
        throw new HttpError(409, "stale_version",
          `Version ${base.version} is no longer the latest (v${v.version - 1} is). Reload and edit the latest version.`);
      }

      // Copy the base version in order, skipping removed items and swapping in updated ones.
      const updates = update.map((u) => ({
        item_id: u.itemId, external_id: u.id ?? null, input: u.input, expected: u.expected ?? null, metadata: u.metadata ?? {},
      }));
      await tx.execute(sql`
        WITH upd AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
            AS u(item_id uuid, external_id text, input jsonb, expected jsonb, metadata jsonb)
        )
        INSERT INTO dataset_items (version_id, position, external_id, input, expected, metadata)
        SELECT ${v.id}, (row_number() OVER (ORDER BY i.position) - 1)::int,
          CASE WHEN u.item_id IS NULL THEN i.external_id ELSE u.external_id END,
          CASE WHEN u.item_id IS NULL THEN i.input ELSE u.input END,
          CASE WHEN u.item_id IS NULL THEN i.expected ELSE u.expected END,
          CASE WHEN u.item_id IS NULL THEN i.metadata ELSE u.metadata END
        FROM dataset_items i LEFT JOIN upd u ON u.item_id = i.id
        WHERE i.version_id = ${base.id}
          AND i.id::text NOT IN (SELECT jsonb_array_elements_text(${JSON.stringify([...removed])}::jsonb))`);
      await insertItems(tx, v.id, add, kept);
      return v;
    });
    await audit(req, req.params.orgId, "dataset.version_created", dataset.id, {
      version: version.version, items: version.itemCount, editedFrom: req.params.version,
      added: add.length, updated: update.length, removed: remove.length,
    });
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

  // ------------------------------------------------------------ saved variants

  const vTags = ["Portal: variants"];
  const variantColumns = {
    id: projectVariants.id, name: projectVariants.name, config: projectVariants.config, position: projectVariants.position,
    createdAt: projectVariants.createdAt, updatedAt: projectVariants.updatedAt,
  };

  app.get("/:orgId/projects/:projectId/variants", {
    schema: { tags: vTags, summary: "Saved variants (configurations) of a project", params: ProjectParams },
    preHandler: requireOrgRole(),
  }, async (req) => {
    await projectInOrg(req.params.orgId, req.params.projectId);
    return {
      variants: await app.db.select(variantColumns).from(projectVariants)
        .where(eq(projectVariants.projectId, req.params.projectId)).orderBy(asc(projectVariants.position)),
    };
  });

  const nameTaken = async (projectId: string, name: string, exceptId?: string) => {
    const [row] = await app.db.select({ id: projectVariants.id }).from(projectVariants)
      .where(and(eq(projectVariants.projectId, projectId), eq(projectVariants.name, name)));
    return Boolean(row && row.id !== exceptId);
  };

  app.post("/:orgId/projects/:projectId/variants", {
    schema: { tags: vTags, summary: "Save a variant", params: ProjectParams, body: VariantBody },
    preHandler: requireOrgRole("admin"),
  }, async (req, reply) => {
    await projectInOrg(req.params.orgId, req.params.projectId);
    if (await nameTaken(req.params.projectId, req.body.name)) {
      throw conflict(`A variant named '${req.body.name}' already exists in this project`);
    }
    const variant = await app.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM projects WHERE id = ${req.params.projectId} FOR UPDATE`);
      const [{ n, next }] = await tx.select({
        n: sql<number>`count(*)::int`, next: sql<number>`coalesce(max(${projectVariants.position}), -1)::int + 1`,
      }).from(projectVariants).where(eq(projectVariants.projectId, req.params.projectId)) as [{ n: number; next: number }];
      if (n >= MAX_VARIANTS) {
        throw new HttpError(422, "too_many_variants", `A project can have at most ${MAX_VARIANTS} saved variants`);
      }
      const [v] = await tx.insert(projectVariants).values({
        projectId: req.params.projectId, name: req.body.name, config: req.body.config, position: next,
      }).returning(variantColumns);
      return v!;
    });
    await audit(req, req.params.orgId, "variant.created", variant.id, { name: variant.name });
    reply.code(201);
    return { variant };
  });

  app.patch("/:orgId/projects/:projectId/variants/:variantId", {
    schema: { tags: vTags, summary: "Edit a saved variant", description: "Past runs keep the config they ran with.", params: VariantParams, body: VariantBody.partial() },
    preHandler: requireOrgRole("admin"),
  }, async (req) => {
    await projectInOrg(req.params.orgId, req.params.projectId);
    if (req.body.name && await nameTaken(req.params.projectId, req.body.name, req.params.variantId)) {
      throw conflict(`A variant named '${req.body.name}' already exists in this project`);
    }
    const [variant] = await app.db.update(projectVariants)
      .set({ ...req.body, updatedAt: new Date() })
      .where(and(eq(projectVariants.id, req.params.variantId), eq(projectVariants.projectId, req.params.projectId)))
      .returning(variantColumns);
    if (!variant) throw notFound("Variant");
    await audit(req, req.params.orgId, "variant.updated", variant.id, { name: variant.name });
    return { variant };
  });

  app.delete("/:orgId/projects/:projectId/variants/:variantId", {
    schema: { tags: vTags, summary: "Delete a saved variant", description: "Past runs keep the config they ran with.", params: VariantParams },
    preHandler: requireOrgRole("admin"),
  }, async (req) => {
    await projectInOrg(req.params.orgId, req.params.projectId);
    const [variant] = await app.db.delete(projectVariants)
      .where(and(eq(projectVariants.id, req.params.variantId), eq(projectVariants.projectId, req.params.projectId)))
      .returning({ id: projectVariants.id, name: projectVariants.name });
    if (!variant) throw notFound("Variant");
    await audit(req, req.params.orgId, "variant.deleted", variant.id, { name: variant.name });
    return { ok: true };
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
  const publicVariant = (v: { id: string; name: string; position: number; config: unknown }) =>
    ({ id: v.id, name: v.name, position: v.position, config: v.config as Record<string, unknown> });
  const attemptColumns = {
    id: attempts.id, status: attempts.status, repeatIndex: attempts.repeatIndex, leaseCount: attempts.leaseCount,
    output: attempts.output, error: attempts.error, latencyMs: attempts.latencyMs, metadata: attempts.metadata,
    leasedAt: attempts.leasedAt, completedAt: attempts.completedAt,
    variant: { id: runVariants.id, name: runVariants.name },
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
    const ids = rows.map((r) => r.id);
    const [progress, variants] = await Promise.all([progressFor(app.db, ids), variantsFor(app.db, ids)]);
    return {
      runs: rows.map((r) => ({ ...r, progress: progress.get(r.id), variants: variants.get(r.id)!.map(publicVariant) })),
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
    const [progress, variants, perVariant] = await Promise.all([
      progressFor(app.db, [run.id]), variantsFor(app.db, [run.id]), variantStats(app.db, run.id),
    ]);
    return {
      run: { ...run, progress: progress.get(run.id), variants: variants.get(run.id)!.map(publicVariant) },
      stats: { ...stats, variants: perVariant },
    };
  });

  app.get("/:orgId/runs/:runNumber/attempts", {
    schema: {
      tags: rTags, summary: "Attempts of a run, with inputs, outputs and expected values",
      params: RunParams,
      querystring: z.object({
        status: z.enum(["pending", "leased", "succeeded", "errored", "abandoned", "cancelled"]).optional(),
        variantId: z.uuid().optional(),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
    },
    preHandler: requireOrgRole(),
  }, async (req) => {
    const [run] = await app.db.select({ id: runs.id }).from(runs)
      .where(and(eq(runs.orgId, req.params.orgId), eq(runs.number, req.params.runNumber)));
    if (!run) throw notFound("Run");
    const where = and(
      eq(attempts.runId, run.id),
      req.query.status ? eq(attempts.status, req.query.status) : undefined,
      req.query.variantId ? eq(attempts.variantId, req.query.variantId) : undefined,
    );
    const rows = await app.db.select({
      ...attemptColumns,
      item: { id: datasetItems.id, externalId: datasetItems.externalId, position: datasetItems.position,
              input: datasetItems.input, expected: datasetItems.expected },
    }).from(attempts).innerJoin(datasetItems, eq(datasetItems.id, attempts.itemId))
      .innerJoin(runVariants, eq(runVariants.id, attempts.variantId))
      .where(where).orderBy(asc(datasetItems.position), asc(attempts.repeatIndex), asc(runVariants.position))
      .offset(req.query.offset).limit(req.query.limit);
    const [{ total }] = await app.db.select({ total: sql<number>`count(*)::int` }).from(attempts).where(where) as [{ total: number }];
    return { attempts: rows, total };
  });

  app.get("/:orgId/runs/:runNumber/matrix", {
    schema: {
      tags: rTags, summary: "Items × variants: each item (and repeat) with every variant's attempt, for side-by-side comparison",
      description: "Paginated over (item, repeat) rows; `total` is the number of rows.",
      params: RunParams,
      querystring: z.object({
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      }),
    },
    preHandler: requireOrgRole(),
  }, async (req) => {
    const [run] = await app.db.select({ id: runs.id, totalAttempts: runs.totalAttempts }).from(runs)
      .where(and(eq(runs.orgId, req.params.orgId), eq(runs.number, req.params.runNumber)));
    if (!run) throw notFound("Run");
    const variants = (await variantsFor(app.db, [run.id])).get(run.id)!;
    const total = run.totalAttempts / Math.max(1, variants.length);

    // Attempts are dense (every item × repeat × variant exists), so a page of rows is a contiguous
    // slice of attempts in (position, repeat, variant) order.
    const rows = await app.db.select({
      ...attemptColumns,
      item: { id: datasetItems.id, externalId: datasetItems.externalId, position: datasetItems.position,
              input: datasetItems.input, expected: datasetItems.expected },
    }).from(attempts).innerJoin(datasetItems, eq(datasetItems.id, attempts.itemId))
      .innerJoin(runVariants, eq(runVariants.id, attempts.variantId))
      .where(eq(attempts.runId, run.id))
      .orderBy(asc(datasetItems.position), asc(attempts.repeatIndex), asc(runVariants.position))
      .offset(req.query.offset * variants.length).limit(req.query.limit * variants.length);

    const matrix: { item: (typeof rows)[number]["item"]; repeatIndex: number; attempts: Omit<(typeof rows)[number], "item">[] }[] = [];
    for (const { item, ...a } of rows) {
      const last = matrix[matrix.length - 1];
      if (last && last.item.id === item.id && last.repeatIndex === a.repeatIndex) last.attempts.push(a);
      else matrix.push({ item, repeatIndex: a.repeatIndex, attempts: [a] });
    }
    return { variants: variants.map(publicVariant), rows: matrix, total };
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
