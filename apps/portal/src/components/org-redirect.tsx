"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/auth-card";
import { Alert, Loading } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { lastOrg, useMe } from "@/lib/hooks";

/** Send the user to their last-used organization (or the first one). */
export function OrgRedirect() {
  const router = useRouter();
  const { data: me, error } = useMe();

  useEffect(() => {
    if (!me) return;
    const remembered = lastOrg();
    const org = me.organizations.find((o) => o.slug === remembered) ?? me.organizations[0];
    if (org) router.replace(`/${org.slug}/runs`);
  }, [me, router]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4">
      <Logo className="text-lg" />
      {error ? <Alert>{errorMessage(error)}</Alert>
        : me && me.organizations.length === 0
          ? <Alert tone="info">You are not a member of any organization yet. Ask an owner to invite you.</Alert>
          : <Loading />}
    </main>
  );
}
