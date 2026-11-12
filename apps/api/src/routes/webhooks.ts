import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import Stripe from "stripe";
import type { Config } from "../config.js";
import { subscriptions } from "../db/schema.js";
import { HttpError } from "../lib/http.js";

const STATUS_MAP: Record<string, "active" | "past_due" | "canceled" | "inactive"> = {
  active: "active", trialing: "active", past_due: "past_due",
  canceled: "canceled", unpaid: "canceled", incomplete_expired: "canceled",
  incomplete: "inactive", paused: "inactive",
};

/** Stripe is the source of truth for subscription state; this keeps our copy in sync. */
export function webhookRoutes(config: Config): FastifyPluginAsync {
  return async (app) => {
    if (config.BILLING_MODE !== "stripe") return;
    const stripe = new Stripe(config.STRIPE_SECRET_KEY!);

    // Signature verification needs the exact raw bytes, so don't parse JSON in this scope.
    app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

    app.post("/stripe", { schema: { hide: true } }, async (req) => {
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body as Buffer, String(req.headers["stripe-signature"] ?? ""), config.STRIPE_WEBHOOK_SECRET!);
      } catch {
        throw new HttpError(400, "invalid_signature", "Webhook signature verification failed");
      }

      if (event.type === "checkout.session.completed") {
        const s = event.data.object;
        if (s.client_reference_id) {
          await app.db.update(subscriptions).set({
            stripeCustomerId: typeof s.customer === "string" ? s.customer : s.customer?.id ?? null,
            stripeSubscriptionId: typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null,
            updatedAt: new Date(),
          }).where(eq(subscriptions.orgId, s.client_reference_id));
        }
      } else if (event.type.startsWith("customer.subscription.")) {
        const sub = event.data.object as Stripe.Subscription;
        const orgId = sub.metadata?.orgId;
        if (orgId) {
          const item = sub.items?.data?.[0];
          const periodEnd = (item as { current_period_end?: number } | undefined)?.current_period_end;
          await app.db.update(subscriptions).set({
            status: event.type === "customer.subscription.deleted" ? "canceled" : STATUS_MAP[sub.status] ?? "inactive",
            stripeSubscriptionId: sub.id,
            stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
            plan: item?.price?.nickname ?? item?.price?.id ?? null,
            currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
            updatedAt: new Date(),
          }).where(eq(subscriptions.orgId, orgId));
        }
      }
      return { received: true };
    });
  };
}
