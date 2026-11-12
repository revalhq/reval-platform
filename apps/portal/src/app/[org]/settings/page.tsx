"use client";

import { type FormEvent, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Alert, Button, Card, Code, Field, Input, Loading } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { date } from "@/lib/format";
import { useOrg } from "@/lib/hooks";
import type { OrgDetail } from "@/lib/types";

export default function GeneralSettings() {
  const { orgApi, can } = useOrg();
  const { mutate: globalMutate } = useSWRConfig();
  const { data, error, mutate } = useSWR<OrgDetail>(orgApi());
  const [status, setStatus] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function rename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name")).trim();
    setSaving(true);
    setStatus(null);
    try {
      await api(orgApi(), { method: "PATCH", body: { json: { name } } });
      await Promise.all([mutate(), globalMutate("/auth/me")]);
      setStatus({ tone: "success", text: "Saved." });
    } catch (err) {
      setStatus({ tone: "error", text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  if (error) return <Alert>{errorMessage(error)}</Alert>;
  if (!data) return <Loading />;
  const org = data.organization;

  return (
    <div className="max-w-2xl space-y-6">
      <Card title="Organization">
        <form onSubmit={rename} className="space-y-4">
          {status && <Alert tone={status.tone}>{status.text}</Alert>}
          <Field label="Name">
            <Input name="name" defaultValue={org.name} required maxLength={100} disabled={!can("admin")} key={org.name} />
          </Field>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-zinc-500">URL slug</dt><dd><Code>{org.slug}</Code> <span className="text-xs text-zinc-500">(doesn’t change on rename, so links keep working)</span></dd>
            <dt className="text-zinc-500">Created</dt><dd>{date(org.createdAt)}</dd>
            <dt className="text-zinc-500">Your role</dt><dd className="capitalize">{data.yourRole}</dd>
          </dl>
          {can("admin") && <Button type="submit" loading={saving}>Save</Button>}
        </form>
      </Card>
    </div>
  );
}
