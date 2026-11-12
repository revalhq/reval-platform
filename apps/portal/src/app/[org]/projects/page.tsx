"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import useSWR from "swr";
import {
  Alert, Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Table, Td, Th, useNow,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { date, num, timeAgo } from "@/lib/format";
import { useOrg } from "@/lib/hooks";
import type { Project } from "@/lib/types";

export default function ProjectsPage() {
  const { orgApi, href, can } = useOrg();
  const router = useRouter();
  const now = useNow();
  const { data, error, mutate } = useSWR<{ projects: Project[] }>(orgApi("/projects"));
  const [creating, setCreating] = useState(false);

  const createButton = can("admin") && <Button onClick={() => setCreating(true)}>New project</Button>;

  return (
    <>
      <PageHeader title="Projects" description="A project groups the datasets and runs for one app or feature." actions={createButton} />
      {error && <Alert>{errorMessage(error)}</Alert>}
      {!data && !error ? <Card><Loading /></Card> : data && data.projects.length === 0 ? (
        <Card>
          <EmptyState title="No projects yet" action={createButton}>
            {can("admin") ? "Create a project, then add a dataset to evaluate against." : "An admin needs to create the first project."}
          </EmptyState>
        </Card>
      ) : data && (
        <Card padded={false}>
          <Table>
            <thead className="bg-zinc-50">
              <tr><Th>Name</Th><Th>Slug</Th><Th className="text-right">Runs</Th><Th>Last run</Th><Th>Created</Th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {data.projects.map((p) => (
                <tr key={p.id} className="hover:bg-zinc-50">
                  <Td><Link href={href(`/projects/${p.slug}`)} className="font-medium text-zinc-900 hover:text-brand-600">{p.name}</Link></Td>
                  <Td className="font-mono text-xs text-zinc-600">{p.slug}</Td>
                  <Td className="text-right tabular-nums">
                    {p.runCount > 0
                      ? <Link href={href(`/runs?project=${p.slug}`)} className="text-brand-600 hover:text-brand-700">{num(p.runCount)}</Link>
                      : <span className="text-zinc-400">0</span>}
                  </Td>
                  <Td className="text-zinc-600">{timeAgo(p.lastRunAt, now)}</Td>
                  <Td className="text-zinc-600">{date(p.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <CreateProjectModal open={creating} onClose={() => setCreating(false)} onCreated={async (p) => {
        await mutate();
        router.push(href(`/projects/${p.slug}`));
      }} />
    </>
  );
}

function CreateProjectModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: (p: Project) => void;
}) {
  const { orgApi } = useOrg();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const slug = String(form.get("slug") ?? "").trim();
    setSaving(true);
    setError(null);
    try {
      const { project } = await api<{ project: Project }>(orgApi("/projects"), {
        body: { json: { name: String(form.get("name")).trim(), ...(slug ? { slug } : {}) } },
      });
      onClose();
      onCreated(project);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New project">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Name"><Input name="name" required maxLength={100} autoFocus placeholder="Support chatbot" /></Field>
        <Field label="Slug" hint="Optional. Your client code refers to the project by this. Defaults to the name, lowercased.">
          <Input name="slug" pattern="[a-z0-9\-]{1,60}" title="Lowercase letters, digits and dashes" placeholder="support-chatbot" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Create project</Button>
        </div>
      </form>
    </Modal>
  );
}
