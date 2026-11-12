"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import useSWR from "swr";
import { ProgressBar, RunStatusBadge } from "@/components/run-ui";
import {
  Alert, Button, Card, Code, EmptyState, Field, Input, Loading, Modal, PageHeader, Table, Td, Textarea, Th, useNow,
} from "@/components/ui";
import { api, errorMessage, withQuery } from "@/lib/api";
import { date, timeAgo } from "@/lib/format";
import { useOrg } from "@/lib/hooks";
import type { Dataset, Project, Run } from "@/lib/types";

export default function ProjectPage() {
  const { project: slug } = useParams<{ project: string }>();
  const { orgApi, href, can } = useOrg();
  const router = useRouter();
  const now = useNow();
  const [creating, setCreating] = useState(false);

  const { data: projects, error: projectsError } = useSWR<{ projects: Project[] }>(orgApi("/projects"));
  const project = projects?.projects.find((p) => p.slug === slug);
  const { data: datasets, error: datasetsError, mutate } =
    useSWR<{ datasets: Dataset[] }>(project ? orgApi(`/projects/${project.id}/datasets`) : null);
  const { data: runs } = useSWR<{ runs: Run[] }>(project ? withQuery(orgApi("/runs"), { projectId: project.id, limit: 5 }) : null);

  if (projectsError) return <Alert>{errorMessage(projectsError)}</Alert>;
  if (!projects) return <Loading />;
  if (!project) {
    return <Card><EmptyState title="Project not found" action={<Link href={href("/projects")} className="text-sm font-medium text-brand-600">All projects</Link>} /></Card>;
  }

  const newDataset = can("admin") && <Button onClick={() => setCreating(true)}>New dataset</Button>;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Projects", href: href("/projects") }, { label: project.name }]}
        title={project.name}
        description={<>Slug <Code>{project.slug}</Code> · created {date(project.createdAt)}</>}
        actions={newDataset}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Datasets" padded={false} className="lg:col-span-2">
          {datasetsError ? <div className="p-4"><Alert>{errorMessage(datasetsError)}</Alert></div>
            : !datasets ? <Loading />
            : datasets.datasets.length === 0 ? (
              <EmptyState title="No datasets yet" action={newDataset}>
                A dataset is a list of inputs to send to your app, with optional expected outputs.
              </EmptyState>
            ) : (
              <Table>
                <thead className="bg-zinc-50"><tr><Th>Name</Th><Th>Slug</Th><Th>Latest</Th><Th>Created</Th></tr></thead>
                <tbody className="divide-y divide-zinc-100">
                  {datasets.datasets.map((d) => (
                    <tr key={d.id} className="hover:bg-zinc-50">
                      <Td>
                        <Link href={href(`/projects/${project.slug}/datasets/${d.slug}`)} className="font-medium text-zinc-900 hover:text-brand-600">{d.name}</Link>
                        {d.description && <p className="max-w-md truncate text-xs text-zinc-500">{d.description}</p>}
                      </Td>
                      <Td className="font-mono text-xs text-zinc-600">{d.slug}</Td>
                      <Td>{d.latestVersion ? <span className="font-mono text-xs">v{d.latestVersion}</span> : <span className="text-xs text-amber-700">no data yet</span>}</Td>
                      <Td className="text-zinc-600">{date(d.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
        </Card>

        <Card title="Recent runs" padded={false}
          actions={project.runCount > 0 && <Link href={href(`/runs?project=${project.slug}`)} className="text-xs font-medium text-brand-600">View all</Link>}>
          {!runs ? <Loading /> : runs.runs.length === 0 ? <EmptyState title="No runs yet" /> : (
            <ul className="divide-y divide-zinc-100">
              {runs.runs.map((r) => (
                <li key={r.id}>
                  <Link href={href(`/runs/${r.number}`)} className="block px-4 py-3 hover:bg-zinc-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-zinc-900"><span className="text-zinc-500">#{r.number}</span> {r.name ?? r.dataset.name}</span>
                      <RunStatusBadge run={r} />
                    </div>
                    <ProgressBar progress={r.progress} className="mt-2" height="h-1.5" />
                    <p className="mt-1 text-xs text-zinc-500">{timeAgo(r.createdAt, now)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <CreateDatasetModal projectId={project.id} open={creating} onClose={() => setCreating(false)}
        onCreated={async (d) => {
          await mutate();
          router.push(href(`/projects/${project.slug}/datasets/${d.slug}`));
        }} />
    </>
  );
}

function CreateDatasetModal({ projectId, open, onClose, onCreated }: {
  projectId: string; open: boolean; onClose: () => void; onCreated: (d: Dataset) => void;
}) {
  const { orgApi } = useOrg();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const slug = String(form.get("slug") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    setSaving(true);
    setError(null);
    try {
      const { dataset } = await api<{ dataset: Dataset }>(orgApi(`/projects/${projectId}/datasets`), {
        body: { json: { name: String(form.get("name")).trim(), ...(slug ? { slug } : {}), ...(description ? { description } : {}) } },
      });
      onClose();
      onCreated(dataset);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New dataset">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Name"><Input name="name" required maxLength={100} autoFocus placeholder="Golden questions" /></Field>
        <Field label="Slug" hint="Optional. Used by your client code. Defaults to the name, lowercased.">
          <Input name="slug" pattern="[a-z0-9\-]{1,60}" title="Lowercase letters, digits and dashes" placeholder="golden-questions" />
        </Field>
        <Field label="Description"><Textarea name="description" rows={3} maxLength={2000} className="font-sans text-sm" /></Field>
        <p className="text-xs text-zinc-500">You’ll upload the items as a JSONL file on the next page.</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Create dataset</Button>
        </div>
      </form>
    </Modal>
  );
}
