import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import Stripe from "stripe";
import { z } from "zod";
import type { Config } from "../../config.js";
import { apiKeys, memberships, organizations, subscriptions, usageRecords, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { generateApiKey } from "../../lib/crypto.js";
import { currentPeriod, HttpError, notFound } from "../../lib/http.js";
import { isSubscriptionActive, requireOrgRole } from "../../plugins/auth.js";

const OrgParams = z.object({ orgId: z.uuid() });

export function orgRoutes(config: Config): FastifyPluginAsyncZod {
  return async (app) => {
    const stripe = config.BILLING_MODE === "stripe" ? new Stripe(config.STRIPE_SECRET_KEY!) : null;

    // ------------------------------------------------------------ organization

    app.get("/:orgId", {
      schema: { tags: ["Portal: organization"], summary: "Organization, subscription and usage", params: OrgParams },
      preHandler: requireOrgRole(),
    }, async (req) => {
      const { orgId } = req.params;
      const [org] = await app.db.select().from(organizations).where(eq(organizations.id, orgId));
      const [sub] = await app.db.select({
        status: subscriptions.status, plan: subscriptions.plan, currentPeriodEnd: subscriptions.currentPeriodEnd,
      }).from(subscriptions).where(eq(subscriptions.orgId, orgId));
      const [usage] = await app.db.select({ attemptsSubmitted: usageRecords.attemptsSubmitted }).from(usageRecords)
        .where(and(eq(usageRecords.orgId, orgId), eq(usageRecords.period, currentPeriod())));
      const members = await app.db.select({
        userId: users.id, name: users.name, email: users.email, role: memberships.role, joinedAt: memberships.createdAt,
      }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.orgId, orgId)).orderBy(memberships.createdAt);
      return {
        organization: org!,
        yourRole: req.membership!.role,
        subscription: sub ?? { status: "inactive", plan: null, currentPeriodEnd: null },
        usage: { period: currentPeriod(), attemptsSubmitted: usage?.attemptsSubmitted ?? 0 },
        members,
        billingMode: config.BILLING_MODE,
      };
    });

    app.patch("/:orgId", {
      schema: {
        tags: ["Portal: organization"], summary: "Rename organization", params: OrgParams,
        body: z.object({ name: z.string().min(1).max(100) }),
      },
      preHandler: requireOrgRole("admin"),
    }, async (req) => {
      const [org] = await app.db.update(organizations).set({ name: req.body.name })
        .where(eq(organizations.id, req.params.orgId)).returning();
      await audit(req, req.params.orgId, "organization.renamed", undefined, { name: req.body.name });
      return { organization: org! };
    });

    // ------------------------------------------------------------ API keys

    const keyTags = ["Portal: API keys"];
    const keyColumns = {
      id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt, createdBy: users.name,
    };

    app.get("/:orgId/api-keys", {
      schema: { tags: keyTags, summary: "List API keys", params: OrgParams },
      preHandler: requireOrgRole(),
    }, async (req) => ({
      apiKeys: await app.db.select(keyColumns).from(apiKeys)
        .leftJoin(users, eq(users.id, apiKeys.createdBy))
        .where(eq(apiKeys.orgId, req.params.orgId)).orderBy(desc(apiKeys.createdAt)),
    }));

    app.post("/:orgId/api-keys", {
      schema: {
        tags: keyTags, summary: "Create an API key",
        description: "The full key is returned once, in this response only. Only a hash is stored.",
        params: OrgParams, body: z.object({ name: z.string().min(1).max(100) }),
      },
      preHandler: requireOrgRole("admin"),
    }, async (req, reply) => {
      const { orgId } = req.params;
      if (!(await isSubscriptionActive(app.db, orgId))) {
        throw new HttpError(402, "subscription_inactive", "Subscribe to a plan before creating API keys");
      }
      const { key, prefix, hash } = generateApiKey();
      const [row] = await app.db.insert(apiKeys).values({
        orgId, name: req.body.name, prefix, keyHash: hash, createdBy: req.user!.id,
      }).returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt });
      await audit(req, orgId, "api_key.created", row!.id, { name: row!.name, prefix });
      reply.code(201);
      return { apiKey: row!, secret: key };
    });

    app.delete("/:orgId/api-keys/:keyId", {
      schema: {
        tags: keyTags, summary: "Revoke an API key",
        params: OrgParams.extend({ keyId: z.uuid() }),
      },
      preHandler: requireOrgRole("admin"),
    }, async (req) => {
      const [row] = await app.db.update(apiKeys).set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, req.params.keyId), eq(apiKeys.orgId, req.params.orgId), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id, prefix: apiKeys.prefix });
      if (!row) throw notFound("Active API key");
      await audit(req, req.params.orgId, "api_key.revoked", row.id, { prefix: row.prefix });
      return { ok: true };
    });

    // ------------------------------------------------------------ billing

    const billingTags = ["Portal: billing"];

    app.post("/:orgId/billing/checkout", {
      schema: {
        tags: billingTags, summary: "Start a Stripe Checkout session",
        description: "Returns a URL to redirect the browser to. The subscription is activated by the Stripe webhook.",
        params: OrgParams,
      },
      preHandler: requireOrgRole("owner"),
    }, async (req) => {
      if (!stripe) throw new HttpError(400, "billing_disabled", "Stripe billing is not configured (BILLING_MODE=dev)");
      const { orgId } = req.params;
      const [sub] = await app.db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
      const [org] = await app.db.select().from(organizations).where(eq(organizations.id, orgId));
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: config.STRIPE_PRICE_ID!, quantity: 1 }],
        client_reference_id: orgId,
        subscription_data: { metadata: { orgId } },
        ...(sub?.stripeCustomerId ? { customer: sub.stripeCustomerId } : { customer_email: req.user!.email }),
        success_url: `${config.PORTAL_URL}/${org!.slug}/settings/billing?checkout=success`,
        cancel_url: `${config.PORTAL_URL}/${org!.slug}/settings/billing?checkout=cancelled`,
      });
      return { url: session.url };
    });

    app.post("/:orgId/billing/portal", {
      schema: { tags: billingTags, summary: "Open the Stripe customer portal (invoices, card, cancel)", params: OrgParams },
      preHandler: requireOrgRole("owner"),
    }, async (req) => {
      if (!stripe) throw new HttpError(400, "billing_disabled", "Stripe billing is not configured (BILLING_MODE=dev)");
      const [sub] = await app.db.select().from(subscriptions).where(eq(subscriptions.orgId, req.params.orgId));
      if (!sub?.stripeCustomerId) throw new HttpError(400, "no_customer", "No billing account yet; subscribe first");
      const [org] = await app.db.select().from(organizations).where(eq(organizations.id, req.params.orgId));
      const session = await stripe.billingPortal.sessions.create({
        customer: sub.stripeCustomerId, return_url: `${config.PORTAL_URL}/${org!.slug}/settings/billing`,
      });
      return { url: session.url };
    });

    if (config.BILLING_MODE === "dev") {
      app.post("/:orgId/billing/dev-activate", {
        schema: { tags: billingTags, summary: "DEV ONLY: activate a subscription without Stripe", params: OrgParams },
        preHandler: requireOrgRole("owner"),
      }, async (req) => {
        await app.db.update(subscriptions).set({ status: "active", plan: "dev", updatedAt: new Date() })
          .where(eq(subscriptions.orgId, req.params.orgId));
        await audit(req, req.params.orgId, "subscription.dev_activated");
        return { ok: true };
      });
    }
  };
}
