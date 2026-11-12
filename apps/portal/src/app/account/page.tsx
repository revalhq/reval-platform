"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Container, TopBar } from "@/components/shell";
import { Alert, Button, Card, Field, Input, Loading, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { lastOrg, useMe } from "@/lib/hooks";

export default function AccountPage() {
  const { data: me, error } = useMe();
  const [status, setStatus] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    if (form.get("newPassword") !== form.get("confirmPassword")) {
      setStatus({ tone: "error", text: "The new passwords don't match." });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      await api("/auth/password", {
        body: { json: { currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") } },
      });
      formEl.reset();
      setStatus({ tone: "success", text: "Password changed. Your other sessions have been signed out." });
    } catch (err) {
      setStatus({ tone: "error", text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  if (error) return <Container><Alert>{errorMessage(error)}</Alert></Container>;
  if (!me) return <Loading />;
  const back = me.organizations.find((o) => o.slug === lastOrg()) ?? me.organizations[0];

  return (
    <>
      <TopBar me={me} org={back} />
      <Container>
        <PageHeader title="Account"
          crumbs={back ? [{ label: back.name, href: `/${back.slug}/runs` }, { label: "Account" }] : undefined} />
        <div className="grid max-w-2xl gap-6">
          <Card title="Profile">
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-zinc-500">Name</dt><dd className="text-zinc-900">{me.user.name}</dd>
              <dt className="text-zinc-500">Email</dt><dd className="text-zinc-900">{me.user.email}</dd>
            </dl>
          </Card>

          <Card title="Organizations">
            <ul className="divide-y divide-zinc-100 text-sm">
              {me.organizations.map((o) => (
                <li key={o.id} className="flex items-center justify-between py-2">
                  <Link href={`/${o.slug}/runs`} className="font-medium text-zinc-900 hover:text-brand-600">{o.name}</Link>
                  <span className="text-zinc-500 capitalize">{o.role}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Change password">
            <form onSubmit={changePassword} className="space-y-4">
              {status && <Alert tone={status.tone}>{status.text}</Alert>}
              <Field label="Current password">
                <Input name="currentPassword" type="password" autoComplete="current-password" required />
              </Field>
              <Field label="New password" hint="At least 10 characters. Changing it signs you out everywhere else.">
                <Input name="newPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={200} />
              </Field>
              <Field label="Confirm new password">
                <Input name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={200} />
              </Field>
              <Button type="submit" loading={saving}>Change password</Button>
            </form>
          </Card>
        </div>
      </Container>
    </>
  );
}
