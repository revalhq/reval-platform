// Response shapes of the portal API (apps/api/src/routes/portal). Timestamps arrive as ISO strings.

export type Role = "owner" | "admin" | "member";
export type SubscriptionStatus = "inactive" | "active" | "past_due" | "canceled";
export type RunStatus = "queued" | "running" | "completed" | "cancelled";
export type AttemptStatus = "pending" | "leased" | "succeeded" | "errored" | "abandoned" | "cancelled";

export interface User { id: string; email: string; name: string }

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
  subscriptionStatus: SubscriptionStatus | null;
}

export interface Me { user: User; organizations: OrgSummary[] }

export interface OrgDetail {
  organization: { id: string; name: string; slug: string; createdAt: string };
  yourRole: Role;
  subscription: { status: SubscriptionStatus; plan: string | null; currentPeriodEnd: string | null };
  usage: { period: string; attemptsSubmitted: number };
  members: { userId: string; name: string; email: string; role: Role; joinedAt: string }[];
  billingMode: "stripe" | "dev";
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  runCount: number;
  lastRunAt: string | null;
}

export interface Dataset {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  latestVersion: number | null;
}

export interface DatasetVersion {
  id: string;
  version: number;
  itemCount: number;
  createdAt: string;
  createdBy: string | null;
}

export interface DatasetItem {
  id: string;
  position: number;
  externalId: string | null;
  input: unknown;
  expected: unknown;
  metadata: Record<string, unknown>;
}

export type Progress = Record<AttemptStatus, number> & { total: number; done: number };

export interface Run {
  id: string;
  number: number;
  name: string | null;
  status: RunStatus;
  config: Record<string, unknown>;
  tags: string[];
  repeats: number;
  timeoutMs: number;
  totalAttempts: number;
  trigger: Record<string, unknown>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastActivityAt: string | null;
  project: { id: string; name: string; slug: string };
  dataset: { id: string; name: string; slug: string; version: number };
  progress: Progress;
}

export interface Attempt {
  id: string;
  status: AttemptStatus;
  repeatIndex: number;
  leaseCount: number;
  output: unknown;
  error: string | null;
  latencyMs: number | null;
  metadata: Record<string, unknown>;
  completedAt: string | null;
  item: { id: string; externalId: string | null; position: number; input: unknown; expected: unknown };
}
