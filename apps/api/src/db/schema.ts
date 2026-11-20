import { sql } from "drizzle-orm";
import {
  bigserial, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp,
  uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------- accounts

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)]);

export const sessions = pgTable("sessions", {
  // sha256 of the cookie token; the raw token only ever lives in the browser
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: createdAt(),
});

export const roleEnum = pgEnum("member_role", ["owner", "admin", "member"]);

export const memberships = pgTable("memberships", {
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull().default("member"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.orgId, t.userId] })]);

// ---------------------------------------------------------------- billing

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "inactive", "active", "past_due", "canceled",
]);

export const subscriptions = pgTable("subscriptions", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  status: subscriptionStatusEnum("status").notNull().default("inactive"),
  plan: text("plan"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usageRecords = pgTable("usage_records", {
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  period: text("period").notNull(), // "2026-11"
  attemptsSubmitted: integer("attempts_submitted").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.orgId, t.period] })]);

export const apiKeys = pgTable("api_keys", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),          // shown in the UI, e.g. "rv_live_a1b2c3"
  keyHash: text("key_hash").notNull().unique(), // sha256 of the full key
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- projects & datasets

export const projects = pgTable("projects", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("projects_org_slug_uq").on(t.orgId, t.slug)]);

export const datasets = pgTable("datasets", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("datasets_project_slug_uq").on(t.projectId, t.slug)]);

/** Versions are immutable: a run always points at exactly the data it was run against. */
export const datasetVersions = pgTable("dataset_versions", {
  id: id(),
  datasetId: uuid("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  itemCount: integer("item_count").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("dataset_versions_uq").on(t.datasetId, t.version)]);

export const datasetItems = pgTable("dataset_items", {
  id: id(),
  versionId: uuid("version_id").notNull().references(() => datasetVersions.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  externalId: text("external_id"),           // the client's own id for the item, optional
  input: jsonb("input").notNull(),           // sent to the client
  expected: jsonb("expected"),               // never sent to the client
  metadata: jsonb("metadata").notNull().default({}),
}, (t) => [index("dataset_items_version_idx").on(t.versionId, t.position)]);

/**
 * Configurations saved on a project (e.g. "gpt-5", "claude-prompt-v3"), managed in the portal.
 * A run started without `config`/`variants` runs all of them; clients can also pick some by name.
 * Runs copy the config into run_variants, so editing a saved variant never changes past runs.
 */
export const projectVariants = pgTable("project_variants", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  config: jsonb("config").notNull().default({}),
  position: integer("position").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("project_variants_project_name_uq").on(t.projectId, t.name)]);

// ---------------------------------------------------------------- runs

export const runStatusEnum = pgEnum("run_status", [
  "queued", "running", "completed", "cancelled",
]);

export const runs = pgTable("runs", {
  id: id(),
  number: integer("number").notNull(), // per-organization, human-friendly "#142"
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  datasetVersionId: uuid("dataset_version_id").notNull().references(() => datasetVersions.id),
  name: text("name"),
  status: runStatusEnum("status").notNull().default("queued"),
  // What the client was testing: model, temperature, prompt version, chunk size...
  // With several variants this is {} and each variant carries its own config.
  config: jsonb("config").notNull().default({}),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  repeats: integer("repeats").notNull(),
  timeoutMs: integer("timeout_ms").notNull(),
  maxLeases: integer("max_leases").notNull(),
  totalAttempts: integer("total_attempts").notNull(),
  // Where the run came from (sdk name/version, cli, ci) for display in the portal
  trigger: jsonb("trigger").notNull().default({}),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
}, (t) => [
  index("runs_project_idx").on(t.projectId, t.createdAt),
  uniqueIndex("runs_org_number_uq").on(t.orgId, t.number),
]);

/**
 * A configuration under test within a run (e.g. two models, two prompts). Every variant runs
 * every item, and the variants of one item are leased together so they execute at the same time.
 * A run without explicit variants has one, named "default".
 */
export const runVariants = pgTable("run_variants", {
  id: id(),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  config: jsonb("config").notNull().default({}),
}, (t) => [
  uniqueIndex("run_variants_run_name_uq").on(t.runId, t.name),
  uniqueIndex("run_variants_run_position_uq").on(t.runId, t.position),
]);

export const attemptStatusEnum = pgEnum("attempt_status", [
  "pending", "leased", "succeeded", "errored", "abandoned", "cancelled",
]);

/** One execution of one dataset item by one variant. repeats=3, 2 variants → six attempts per item. */
export const attempts = pgTable("attempts", {
  id: id(),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => datasetItems.id),
  variantId: uuid("variant_id").notNull().references(() => runVariants.id, { onDelete: "cascade" }),
  repeatIndex: integer("repeat_index").notNull(),
  status: attemptStatusEnum("status").notNull().default("pending"),
  leaseId: uuid("lease_id"),
  leasedAt: timestamp("leased_at", { withTimezone: true }), // when the current/last lease was handed out
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  leaseCount: integer("lease_count").notNull().default(0),
  output: jsonb("output"),
  error: text("error"),
  latencyMs: integer("latency_ms"),
  // Client-reported: tokens, cost, model, etc.
  metadata: jsonb("metadata").notNull().default({}),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  index("attempts_run_status_idx").on(t.runId, t.status),
  uniqueIndex("attempts_run_item_repeat_variant_uq").on(t.runId, t.itemId, t.repeatIndex, t.variantId),
]);

/** Placeholder for the evaluation stage, which is out of scope for now. */
export const evaluations = pgTable("evaluations", {
  id: id(),
  attemptId: uuid("attempt_id").notNull().references(() => attempts.id, { onDelete: "cascade" }),
  evaluator: text("evaluator").notNull(),
  evaluatorVersion: text("evaluator_version").notNull(),
  result: jsonb("result").notNull(),
  createdAt: createdAt(),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorApiKeyId: uuid("actor_api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details").notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("audit_org_idx").on(t.orgId, t.createdAt)]);
