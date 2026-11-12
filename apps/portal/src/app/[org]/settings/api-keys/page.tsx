"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import useSWR from "swr";
import {
  Alert, Badge, Button, Card, Code, CopyButton, EmptyState, Field, Input, Loading, Modal, Table, Td, Th, useNow,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { date, timeAgo } from "@/lib/format";
import { useOrg } from "@/lib/hooks";
import type { ApiKey } from "@/lib/types";

export default function ApiKeysPage() {
  const { orgApi, href, can, subscriptionActive } = useOrg();
  const now = useNow();
  const { data, error, mutate } = useSWR<{ apiKeys: ApiKey[] }>(orgApi("/api-keys"));
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ name: string; key: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function revoke(k: ApiKey) {
    if (!confirm(`Revoke “${k.name}” (${k.prefix}…)? Anything using it will stop working immediately.`)) return;
    setActionError(null);
    try {
      await api(orgApi(`/api-keys/${k.id}`), { method: "DELETE" });
      await mutate();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  const isAdmin = can("admin");
  const createButton = isAdmin && (
    <Button onClick={() => setCreating(true)} disabled={!subscriptionActive}
      title={subscriptionActive ? undefined : "Requires an active subscription"}>Create API key</Button>
  );

  return (
    <div className="space-y-4">
      {!subscriptionActive && (
        <Alert tone="warning" action={<Link href={href("/settings/billing")} className="font-medium underline">Billing</Link>}>
          API keys only work while the organization has an active subscription.
        </Alert>
      )}
      {actionError && <Alert>{actionError}</Alert>}

      <Card padded={false} title="API keys" actions={createButton}>
        {error ? <div className="p-4"><Alert>{errorMessage(error)}</Alert></div>
          : !data ? <Loading />
          : data.apiKeys.length === 0 ? (
            <EmptyState title="No API keys yet" action={createButton}>
              Your client package sends the key as <Code>Authorization: Bearer rv_live_…</Code>. Store it as a secret, e.g. <Code>REVAL_API_KEY</Code>.
            </EmptyState>
          ) : (
            <Table>
              <thead className="bg-zinc-50">
                <tr><Th>Name</Th><Th>Key</Th><Th>Created</Th><Th>Last used</Th><Th>Status</Th>{isAdmin && <Th />}</tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.apiKeys.map((k) => (
                  <tr key={k.id} className={k.revokedAt ? "text-zinc-400" : undefined}>
                    <Td className="font-medium">{k.name}</Td>
                    <Td className="font-mono text-xs">{k.prefix}…</Td>
                    <Td className="text-zinc-600">{date(k.createdAt)}{k.createdBy && <span className="text-zinc-400"> by {k.createdBy}</span>}</Td>
                    <Td className="text-zinc-600">{k.lastUsedAt ? timeAgo(k.lastUsedAt, now) : "Never"}</Td>
                    <Td>{k.revokedAt ? <Badge>Revoked {date(k.revokedAt)}</Badge> : <Badge tone="green">Active</Badge>}</Td>
                    {isAdmin && <Td className="text-right">{!k.revokedAt && <Button variant="danger" size="sm" onClick={() => revoke(k)}>Revoke</Button>}</Td>}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
      </Card>

      <CreateKeyModal open={creating} onClose={() => setCreating(false)}
        onCreated={async (name, key) => { setCreating(false); setSecret({ name, key }); await mutate(); }} />

      <Modal open={secret !== null} onClose={() => setSecret(null)} title="Copy your API key">
        {secret && (
          <div className="space-y-4">
            <Alert tone="warning">This is the only time the key is shown. Store it somewhere safe now; we only keep a hash.</Alert>
            <div className="flex items-center gap-2">
              <input readOnly value={secret.key} onFocus={(e) => e.currentTarget.select()} aria-label={`API key ${secret.name}`}
                className="block w-full rounded-md bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-900 ring-1 ring-zinc-300 ring-inset" />
              <CopyButton text={secret.key} />
            </div>
            <p className="text-xs text-zinc-500">For example: <Code>export REVAL_API_KEY={secret.key.slice(0, 12)}…</Code></p>
            <div className="flex justify-end"><Button onClick={() => setSecret(null)}>I’ve saved it</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function CreateKeyModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: (name: string, key: string) => void;
}) {
  const { orgApi } = useOrg();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name")).trim();
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ apiKey: { name: string }; secret: string }>(orgApi("/api-keys"), { body: { json: { name } } });
      onCreated(res.apiKey.name, res.secret);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create API key">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Name" hint="Where it will be used, e.g. “GitHub Actions” or “Local dev”.">
          <Input name="name" required maxLength={100} autoFocus />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Create key</Button>
        </div>
      </form>
    </Modal>
  );
}
