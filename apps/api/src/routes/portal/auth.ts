import { and, eq, sql } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { Db } from "../../db/client.js";
import { memberships, organizations, sessions, subscriptions, users } from "../../db/schema.js";
import { hashPassword, randomToken, sha256, verifyPassword } from "../../lib/crypto.js";
import { conflict, HttpError, slugify } from "../../lib/http.js";
import { requireUser, SESSION_COOKIE } from "../../plugins/auth.js";

/** Org slugs are the first path segment of portal URLs (/acme/runs), so they can't shadow portal pages. */
const RESERVED_ORG_SLUGS = new Set([
  "login", "register", "account", "logout", "portal", "api", "v1", "docs", "health", "webhooks",
  "settings", "admin", "new", "static", "_next",
]);

export async function uniqueOrgSlug(db: Db, name: string) {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    if (RESERVED_ORG_SLUGS.has(slug)) continue;
    const [hit] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug));
    if (!hit) return slug;
  }
  return `${base}-${randomToken(4).toLowerCase()}`;
}

export function authRoutes(config: Config): FastifyPluginAsyncZod {
  return async (app) => {
    const tags = ["Portal: auth"];

    async function startSession(reply: FastifyReply, userId: string) {
      const token = randomToken();
      const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 86_400_000);
      await app.db.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt });
      reply.setCookie(SESSION_COOKIE, token, {
        path: "/", httpOnly: true, sameSite: "lax", secure: config.COOKIE_SECURE, expires: expiresAt,
      });
    }

    async function me(userId: string) {
      const [user] = await app.db.select({ id: users.id, email: users.email, name: users.name })
        .from(users).where(eq(users.id, userId));
      const orgs = await app.db.select({
        id: organizations.id, name: organizations.name, slug: organizations.slug,
        role: memberships.role, subscriptionStatus: subscriptions.status,
      }).from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.orgId))
        .leftJoin(subscriptions, eq(subscriptions.orgId, organizations.id))
        .where(eq(memberships.userId, userId)).orderBy(organizations.name);
      return { user: user!, organizations: orgs };
    }

    app.post("/register", {
      schema: {
        tags, summary: "Create an account and its first organization",
        body: z.object({
          email: z.email().max(254),
          password: z.string().min(10).max(200),
          name: z.string().min(1).max(100),
          organizationName: z.string().min(1).max(100).optional(),
        }),
      },
    }, async (req, reply) => {
      const { email, password, name, organizationName } = req.body;
      const [existing] = await app.db.select({ id: users.id }).from(users)
        .where(sql`lower(${users.email}) = lower(${email})`);
      if (existing) throw conflict("An account with this email already exists");

      const passwordHash = await hashPassword(password);
      const orgName = organizationName ?? `${name}'s workspace`;
      const slug = await uniqueOrgSlug(app.db, orgName);
      const userId = await app.db.transaction(async (tx) => {
        const [user] = await tx.insert(users).values({ email, name, passwordHash }).returning({ id: users.id });
        const [org] = await tx.insert(organizations).values({ name: orgName, slug }).returning({ id: organizations.id });
        await tx.insert(memberships).values({ orgId: org!.id, userId: user!.id, role: "owner" });
        await tx.insert(subscriptions).values({ orgId: org!.id });
        return user!.id;
      });
      await startSession(reply, userId);
      reply.code(201);
      return me(userId);
    });

    app.post("/login", {
      schema: { tags, summary: "Log in", body: z.object({ email: z.email(), password: z.string() }) },
    }, async (req, reply) => {
      const [user] = await app.db.select().from(users)
        .where(sql`lower(${users.email}) = lower(${req.body.email})`);
      // Same error for unknown email and wrong password.
      if (!user || !(await verifyPassword(req.body.password, user.passwordHash))) {
        throw new HttpError(401, "invalid_credentials", "Email or password is incorrect");
      }
      await startSession(reply, user.id);
      return me(user.id);
    });

    app.post("/logout", { schema: { tags, summary: "Log out" } }, async (req, reply) => {
      const token = req.cookies[SESSION_COOKIE];
      if (token) await app.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    });

    app.get("/me", { schema: { tags, summary: "Current user and organizations" }, preHandler: requireUser },
      async (req) => me(req.user!.id));

    app.post("/password", {
      schema: {
        tags, summary: "Change password",
        body: z.object({ currentPassword: z.string(), newPassword: z.string().min(10).max(200) }),
      },
      preHandler: requireUser,
    }, async (req, reply) => {
      const [user] = await app.db.select().from(users).where(eq(users.id, req.user!.id));
      if (!(await verifyPassword(req.body.currentPassword, user!.passwordHash))) {
        throw new HttpError(401, "invalid_credentials", "Current password is incorrect");
      }
      await app.db.update(users).set({ passwordHash: await hashPassword(req.body.newPassword) })
        .where(eq(users.id, user!.id));
      // Sign out everywhere, then issue a fresh session for this browser.
      await app.db.delete(sessions).where(and(eq(sessions.userId, user!.id)));
      await startSession(reply, user!.id);
      return { ok: true };
    });
  };
}
