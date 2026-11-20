/**
 * Public API (/v1), authenticated with API keys. This is the contract every client
 * package (Node, Python, PHP, Java, CLI) implements, so changes here must stay
 * backwards compatible. Response schemas are declared so the OpenAPI spec is complete.
 */
import rateLimit from "@fastify/rate-limit";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config.js";
import { organizations } from "../../db/schema.js";
import { sha256 } from "../../lib/crypto.js";
import { requireApiKey } from "../../plugins/auth.js";
import {
  cancelRun, createRun, getOrgRun, leaseTasks, type Progress, progressFor, submitResults,
} from "../../services/runs.js";

const RunStatus = z.enum(["queued", "running", "completed", "cancelled"]);
const ProgressSchema = z.object({
  total: z.number(), done: z.number(), pending: z.number(), leased: z.number(),
  succeeded: z.number(), errored: z.number(), abandoned: z.number(), cancelled: z.number(),
});
const RunSummary = z.object({
  id: z.uuid(),
  number: z.number(),
  status: RunStatus,
  url: z.string().describe("Link to the run in the portal"),
  progress: ProgressSchema,
});
const ErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.any().optional() }) });
const RunParams = z.object({ runId: z.uuid() });
const ConfigSchema = z.record(z.string(), z.unknown());
const VariantSchema = z.object({
  name: z.string().trim().min(1).max(50).describe("Label shown in the portal, unique within the run, e.g. 'gpt-5' or 'prompt-v2'"),
  config: ConfigSchema.optional().describe("What this variant tests; sent back with each of its tasks"),
});

export function v1Routes(config: Config): FastifyPluginAsyncZod {
  return async (app) => {
    await app.register(rateLimit, {
      max: config.PUBLIC_API_RATE_LIMIT_PER_MIN,
      timeWindow: "1 minute",
      keyGenerator: (req) => sha256(req.headers.authorization ?? req.ip),
      errorResponseBuilder: (_req, ctx) => ({
        statusCode: 429,
        error: { code: "rate_limited", message: `Rate limit exceeded, retry in ${Math.ceil(ctx.ttl / 1000)}s` },
      }),
    });
    app.addHook("onRequest", requireApiKey);

    const runUrl = (orgSlug: string, runNumber: number) => `${config.PORTAL_URL}/${orgSlug}/runs/${runNumber}`;
    const orgSlug = async (orgId: string) =>
      (await app.db.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, orgId)))[0]!.slug;
    const summary = (run: { id: string; number: number; status: z.infer<typeof RunStatus> }, slug: string, p: Progress) =>
      ({ id: run.id, number: run.number, status: run.status, url: runUrl(slug, run.number), progress: p });

    const tags = ["Public API"];
    const security = [{ apiKey: [] }];
    const errors = { 401: ErrorSchema, 402: ErrorSchema, 404: ErrorSchema };

    app.get("/whoami", {
      schema: {
        tags, security, summary: "Check an API key",
        response: { 200: z.object({ organization: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }) }), ...errors },
      },
    }, async (req) => {
      const [org] = await app.db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
        .from(organizations).where(eq(organizations.id, req.apiKey!.orgId));
      return { organization: org! };
    });

    app.post("/runs", {
      schema: {
        tags, security, summary: "Start a run",
        description: "Creates a run over a dataset version. The response tells the client how to execute it.",
        body: z.object({
          project: z.string().describe("Project slug"),
          dataset: z.string().describe("Dataset slug"),
          datasetVersion: z.int().positive().optional().describe("Defaults to the latest version"),
          name: z.string().max(200).optional(),
          config: ConfigSchema.optional()
            .describe("What is being tested, e.g. { model, temperature, promptVersion }. Shorthand for a single variant; don't combine with `variants`."),
          variants: z.array(z.union([
            z.string().trim().min(1).max(50).describe("Name of a variant saved on the project in the portal"),
            VariantSchema,
          ])).min(1).max(10).optional().describe([
            "Configurations to compare in this run: inline { name, config } objects and/or names of variants saved",
            "on the project. Every variant runs every item, and the variants of one item are leased together so the",
            "client can run them at the same time. Omit both `config` and `variants` to run all of the project's saved variants.",
          ].join(" ")),
          tags: z.array(z.string().max(50)).max(20).optional(),
          repeats: z.int().min(1).max(20).default(1),
          timeoutMs: z.int().min(1_000).max(900_000).default(120_000),
          limit: z.int().positive().optional().describe("Only run the first N items"),
          trigger: z.record(z.string(), z.unknown()).optional()
            .describe("Client info, e.g. { client: 'node', version: '0.1.0', ci: true }"),
        }),
        response: {
          201: RunSummary.extend({
            variants: z.array(z.object({ name: z.string(), config: ConfigSchema })),
            execution: z.object({
              timeoutMs: z.number().describe("Abort each solver call after this long"),
              concurrency: z.number().describe("Recommended number of parallel solver calls"),
              pollIntervalMs: z.number().describe("Wait this long when a lease returns no tasks"),
            }),
          }),
          ...errors,
        },
      },
    }, async (req, reply) => {
      const b = req.body;
      const { run, variants } = await createRun(app.db, {
        orgId: req.apiKey!.orgId, apiKeyId: req.apiKey!.keyId,
        project: b.project, dataset: b.dataset, datasetVersion: b.datasetVersion,
        name: b.name, config: b.config, variants: b.variants, tags: b.tags, repeats: b.repeats, timeoutMs: b.timeoutMs,
        maxLeases: 3, limit: b.limit, trigger: b.trigger,
      });
      const progress = (await progressFor(app.db, [run.id])).get(run.id)!;
      reply.code(201);
      return {
        ...summary(run, await orgSlug(run.orgId), progress),
        variants: variants.map((v) => ({ name: v.name, config: v.config as Record<string, unknown> })),
        execution: {
          timeoutMs: run.timeoutMs,
          concurrency: config.RECOMMENDED_CONCURRENCY,
          pollIntervalMs: config.POLL_INTERVAL_MS,
        },
      };
    });

    app.post("/runs/:runId/lease", {
      schema: {
        tags, security, summary: "Lease tasks to execute",
        description: [
          "Returns up to `max` tasks. Submit each result with its leaseId before leaseExpiresAt.",
          "Tasks for the same item and repeat (one per variant) always come together, so run them at the same time;",
          "if a run has more variants than `max`, one item's tasks are returned anyway.",
          "When `tasks` is empty: stop if `done` is true, otherwise wait `retryAfterMs` and lease again",
          "(other clients still hold leases that may expire and be handed out again).",
        ].join(" "),
        params: RunParams,
        body: z.object({ max: z.int().min(1).max(50).default(10) }),
        response: {
          200: z.object({
            status: RunStatus,
            done: z.boolean(),
            retryAfterMs: z.number().optional(),
            tasks: z.array(z.object({
              attemptId: z.uuid(),
              leaseId: z.uuid(),
              leaseExpiresAt: z.iso.datetime(),
              itemId: z.string().describe("The dataset item's own id, if it had one"),
              repeatIndex: z.number(),
              variant: z.string().describe("Name of the variant this task is for (\"default\" for single-config runs)"),
              config: ConfigSchema.describe("The variant's config: pass it to the solver"),
              input: z.any(),
            })),
          }),
          ...errors,
        },
      },
    }, async (req) => {
      const { run, tasks, outstanding } = await leaseTasks(
        app.db, req.apiKey!.orgId, req.params.runId, req.body.max, config.LEASE_GRACE_MS);
      const done = tasks.length === 0 && outstanding === 0;
      return {
        status: run.status,
        done: done || run.status === "cancelled" || run.status === "completed",
        retryAfterMs: tasks.length === 0 && !done ? config.POLL_INTERVAL_MS : undefined,
        tasks: tasks.map((t) => ({ ...t, leaseExpiresAt: t.leaseExpiresAt.toISOString() })),
      };
    });

    app.post("/runs/:runId/results", {
      schema: {
        tags, security, summary: "Submit results",
        description: "Send `output` for a success or `error` for a failure. Results with an unknown or stale lease are rejected.",
        params: RunParams,
        body: z.object({
          results: z.array(z.object({
            attemptId: z.uuid(),
            leaseId: z.uuid(),
            output: z.any().optional(),
            error: z.string().optional(),
            latencyMs: z.int().min(0).optional(),
            metadata: z.record(z.string(), z.unknown()).optional()
              .describe("e.g. { inputTokens, outputTokens, costUsd, model }"),
          })).min(1).max(100),
        }),
        response: {
          200: z.object({
            status: RunStatus,
            accepted: z.array(z.uuid()),
            rejected: z.array(z.object({ attemptId: z.uuid(), reason: z.string() })),
          }),
          ...errors,
        },
      },
    }, async (req) => {
      const { run, accepted, rejected } = await submitResults(app.db, req.apiKey!.orgId, req.params.runId, req.body.results);
      return { status: run.status, accepted, rejected };
    });

    app.get("/runs/:runId", {
      schema: { tags, security, summary: "Get run status", params: RunParams, response: { 200: RunSummary, ...errors } },
    }, async (req) => {
      const run = await getOrgRun(app.db, req.apiKey!.orgId, req.params.runId);
      const progress = (await progressFor(app.db, [run.id])).get(run.id)!;
      return summary(run, await orgSlug(run.orgId), progress);
    });

    app.post("/runs/:runId/cancel", {
      schema: { tags, security, summary: "Cancel a run", params: RunParams, response: { 200: RunSummary, ...errors } },
    }, async (req) => {
      const run = await cancelRun(app.db, req.apiKey!.orgId, req.params.runId);
      const progress = (await progressFor(app.db, [run.id])).get(run.id)!;
      return summary(run, await orgSlug(run.orgId), progress);
    });
  };
}
