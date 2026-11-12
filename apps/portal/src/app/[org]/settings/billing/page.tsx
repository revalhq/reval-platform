"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Alert, Badge, Button, Card, Loading } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { date, num } from "@/lib/format";
import { useOrg } from "@/lib/hooks";
import type { OrgDetail, SubscriptionStatus } from "@/lib/types";

const STATUS: Record<SubscriptionStatus, { label: string; tone: "green" | "amber" | "red" | "zinc" }> = {
  active: { label: "Active", tone: "green" },
  past_due: { label: "Past due", tone: "amber" },
  canceled: { label: "Canceled", tone: "red" },
  inactive: { label: "Not subscribed", tone: "zinc" },
};

function Billing() {
  const { orgApi, can } = useOrg();
  const params = useSearchParams();
  const checkout = params.get("checkout");
  const { mutate: globalMutate } = useSWRConfig();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Back from Stripe Checkout: the webhook activates the subscription, usually within seconds.
  const [waitingForWebhook, setWaitingForWebhook] = useState(checkout === "success");
  const { data, error, mutate } = useSWR<OrgDetail>(orgApi(), { refreshInterval: waitingForWebhook ? 2_000 : 0 });
  const status = data?.subscription.status;
  const active = status === "active" || status === "past_due";

  useEffect(() => {
    if (!waitingForWebhook) return;
    if (active) { setWaitingForWebhook(false); void globalMutate("/auth/me"); return; }
    const t = setTimeout(() => setWaitingForWebhook(false), 60_000);
    return () => clearTimeout(t);
  }, [waitingForWebhook, active, globalMutate]);

  async function go(action: "checkout" | "portal" | "dev-activate") {
    setBusy(action);
    setActionError(null);
    try {
      const res = await api<{ url?: string | null }>(orgApi(`/billing/${action}`), { method: "POST" });
      if (res.url) { window.location.assign(res.url); return; }
      await Promise.all([mutate(), globalMutate("/auth/me")]);
    } catch (err) {
      setActionError(errorMessage(err));
    }
    setBusy(null);
  }

  if (error) return <Alert>{errorMessage(error)}</Alert>;
  if (!data) return <Loading />;
  const { subscription: sub, usage, billingMode } = data;
  const s = STATUS[sub.status];
  const isOwner = can("owner");

  return (
    <div className="max-w-2xl space-y-6">
      {checkout === "success" && (active
        ? <Alert tone="success">Thanks! Your subscription is active.</Alert>
        : waitingForWebhook
          ? <Alert tone="info">Payment received. Activating your subscription…</Alert>
          : <Alert tone="warning">Payment received, but activation is taking longer than usual. Refresh in a minute; contact support if it doesn’t update.</Alert>)}
      {checkout === "cancelled" && !active && <Alert tone="info">Checkout was cancelled. You haven’t been charged.</Alert>}
      {actionError && <Alert>{actionError}</Alert>}

      <Card title="Subscription">
        <dl className="grid grid-cols-[9rem_1fr] gap-y-3 text-sm">
          <dt className="text-zinc-500">Status</dt><dd><Badge tone={s.tone}>{s.label}</Badge></dd>
          <dt className="text-zinc-500">Plan</dt><dd className="capitalize">{sub.plan ?? "—"}</dd>
          {sub.currentPeriodEnd && <><dt className="text-zinc-500">{sub.status === "canceled" ? "Ended" : "Renews"}</dt><dd>{date(sub.currentPeriodEnd)}</dd></>}
        </dl>
        {sub.status === "past_due" && (
          <div className="mt-4"><Alert tone="warning">Your last payment failed. Update your card to avoid interruption.</Alert></div>
        )}

        <div className="mt-5 flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
          {!isOwner ? (
            <p className="text-sm text-zinc-600">Only organization owners can change billing.</p>
          ) : billingMode === "dev" ? (
            <>
              {!active && <Button loading={busy === "dev-activate"} onClick={() => go("dev-activate")}>Activate (dev mode)</Button>}
              <p className="w-full text-xs text-zinc-500">
                The API runs with <code className="font-mono">BILLING_MODE=dev</code>: Stripe is bypassed{active ? " and the subscription is active" : ""}.
              </p>
            </>
          ) : (
            <>
              {!active && <Button loading={busy === "checkout"} onClick={() => go("checkout")}>Subscribe</Button>}
              {sub.status !== "inactive" && (
                <Button variant={active ? "primary" : "secondary"} loading={busy === "portal"} onClick={() => go("portal")}>
                  Manage billing
                </Button>
              )}
              <p className="w-full text-xs text-zinc-500">Payments, invoices and cancellation are handled securely by Stripe.</p>
            </>
          )}
        </div>
      </Card>

      <Card title="Usage this month">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-zinc-900 tabular-nums">{num(usage.attemptsSubmitted)}</span>
          <span className="text-sm text-zinc-600">attempts submitted in {usage.period}</span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">An attempt is one dataset item × one repeat, counted when your client submits its result.</p>
      </Card>
    </div>
  );
}

export default function BillingPage() {
  return <Suspense fallback={<Loading />}><Billing /></Suspense>;
}
