import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db/client.js";
import { apiKeys, memberships, sessions, subscriptions, users } from "../db/schema.js";
import { sha256 } from "../lib/crypto.js";
import { forbidden, HttpError } from "../lib/http.js";

export const SESSION_COOKIE = "rv_session";

export type Role = "owner" | "admin" | "member";
const ROLE_RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

export interface SessionUser { id: string; email: string; name: string }
export interface ApiKeyAuth { keyId: string; orgId: string }

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
    membership?: { orgId: string; role: Role };
    apiKey?: ApiKeyAuth;
  }
  interface FastifyInstance {
    db: Db;
  }
}

const unauthorized = () => new HttpError(401, "unauthorized", "Authentication required");

/** Portal: resolve the session cookie to a user. */
export async function requireUser(req: FastifyRequest, _reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) throw unauthorized();
  const [row] = await req.server.db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
  if (!row) throw unauthorized();
  req.user = row;
}

/** Portal: the user must belong to the org in the :orgId route param, with at least `minRole`. */
export function requireOrgRole(minRole: Role = "member") {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) await requireUser(req, reply);
    const { orgId } = req.params as { orgId?: string };
    if (!orgId) throw forbidden();
    const [m] = await req.server.db.select({ role: memberships.role }).from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, req.user!.id)));
    // Same 404 for "doesn't exist" and "not yours", so org ids can't be probed.
    if (!m) throw new HttpError(404, "not_found", "Organization not found");
    if (ROLE_RANK[m.role] < ROLE_RANK[minRole]) throw forbidden(`Requires ${minRole} role`);
    req.membership = { orgId, role: m.role };
  };
}

export async function isSubscriptionActive(db: Db, orgId: string): Promise<boolean> {
  const [sub] = await db.select({ status: subscriptions.status }).from(subscriptions)
    .where(eq(subscriptions.orgId, orgId));
  // past_due keeps working while Stripe retries the payment
  return sub?.status === "active" || sub?.status === "past_due";
}

/** Public API: Bearer API key, live subscription required. */
export async function requireApiKey(req: FastifyRequest, _reply: FastifyReply) {
  const header = req.headers.authorization ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key.startsWith("rv_")) {
    throw new HttpError(401, "invalid_api_key", "Missing or malformed API key. Use 'Authorization: Bearer rv_live_...'");
  }
  const db = req.server.db;
  const [row] = await db.select({ id: apiKeys.id, orgId: apiKeys.orgId, lastUsedAt: apiKeys.lastUsedAt })
    .from(apiKeys).where(and(eq(apiKeys.keyHash, sha256(key)), isNull(apiKeys.revokedAt)));
  if (!row) throw new HttpError(401, "invalid_api_key", "API key is invalid or has been revoked");
  if (!(await isSubscriptionActive(db, row.orgId))) {
    throw new HttpError(402, "subscription_inactive", "This organization has no active subscription");
  }
  // Avoid a write on every request: refresh last_used_at at most once a minute.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  }
  req.apiKey = { keyId: row.id, orgId: row.orgId };
}
