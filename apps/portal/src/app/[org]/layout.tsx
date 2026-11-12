"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { Container, TopBar } from "@/components/shell";
import { Alert, Loading } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { buildOrgContext, OrgContext, rememberOrg, useMe } from "@/lib/hooks";

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  const { org: slug } = useParams<{ org: string }>();
  const { data: me, error } = useMe();
  const org = me?.organizations.find((o) => o.slug === slug);
  const ctx = useMemo(() => (me && org ? buildOrgContext(me, org) : null), [me, org]);

  useEffect(() => { if (org) rememberOrg(org.slug); }, [org]);

  if (error) return <Container><Alert>{errorMessage(error)}</Alert></Container>;
  if (!me) return <Loading />;
  if (!org || !ctx) {
    return (
      <>
        <TopBar me={me} />
        <Container>
          <Alert action={<Link href="/" className="font-medium underline">Go to your organizations</Link>}>
            Organization not found, or you are not a member of it.
          </Alert>
        </Container>
      </>
    );
  }

  return (
    <OrgContext.Provider value={ctx}>
      <TopBar me={me} org={org} />
      {!ctx.subscriptionActive && (
        <div className="border-b border-amber-200 bg-amber-50">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-amber-900 sm:px-6">
            <span>
              {org.subscriptionStatus === "canceled" ? "Your subscription has ended." : "This organization has no active subscription."}
              {" "}API keys and runs need one.
            </span>
            <Link href={ctx.href("/settings/billing")} className="font-medium underline underline-offset-2">
              {ctx.can("owner") ? "Set up billing" : "View billing"}
            </Link>
          </div>
        </div>
      )}
      <Container>{children}</Container>
    </OrgContext.Provider>
  );
}
