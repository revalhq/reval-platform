"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useState } from "react";
import useSWR from "swr";
import {
  Alert, Button, Card, Code, CopyButton, cx, EmptyState, JsonView, Loading, Modal, PageHeader, Pager, Table, Td,
  Textarea, Th,
} from "@/components/ui";
import { api, errorMessage, type RequestOptions, withQuery } from "@/lib/api";
import { dateTime, num, preview } from "@/lib/format";
import { useOrg } from "@/lib/hooks";
import type { Dataset, DatasetItem, DatasetVersion, Project } from "@/lib/types";

const PAGE = 50;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // matches the API's bodyLimit for uploads
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function DatasetView() {
  const { project: projectSlug, dataset: datasetSlug } = useParams<{ project: string; dataset: string }>();
  const { orgApi, href, can } = useOrg();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [uploading, setUploading] = useState(false);
  const [offset, setOffset] = useState(0);

  const { data: projects, error: e1 } = useSWR<{ projects: Project[] }>(orgApi("/projects"));
  const project = projects?.projects.find((p) => p.slug === projectSlug);
  const { data: datasets, error: e2 } = useSWR<{ datasets: Dataset[] }>(project ? orgApi(`/projects/${project.id}/datasets`) : null);
  const found = datasets?.datasets.find((d) => d.slug === datasetSlug);
  const datasetPath = project && found ? orgApi(`/projects/${project.id}/datasets/${found.id}`) : null;
  const { data: detail, error: e3, mutate } = useSWR<{ dataset: Dataset; versions: DatasetVersion[] }>(datasetPath);

  const requested = Number(params.get("version"));
  const latest = detail?.versions[0];
  const selected = detail?.versions.find((v) => v.version === requested) ?? latest;
  const { data: items, error: itemsError, isLoading: itemsLoading } = useSWR<{ items: DatasetItem[]; total: number }>(
    datasetPath && selected ? withQuery(`${datasetPath}/versions/${selected.version}/items`, { offset, limit: PAGE }) : null,
    { keepPreviousData: true },
  );

  const error = e1 ?? e2 ?? e3;
  if (error) return <Alert>{errorMessage(error)}</Alert>;
  if (!projects || (project && !datasets) || (found && !detail)) return <Loading />;
  if (!project || !found || !detail) {
    return <Card><EmptyState title="Dataset not found" action={<Link href={href("/projects")} className="text-sm font-medium text-brand-600">All projects</Link>} /></Card>;
  }
  const { dataset, versions } = detail;

  function selectVersion(v: number) {
    setOffset(0);
    router.replace(v === latest?.version ? pathname : `${pathname}?version=${v}`);
  }

  const uploadButton = can("admin") && (
    <Button onClick={() => setUploading(true)}>{versions.length ? "Upload new version" : "Upload items"}</Button>
  );

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Projects", href: href("/projects") },
          { label: project.name, href: href(`/projects/${project.slug}`) },
          { label: dataset.name },
        ]}
        title={dataset.name}
        description={<>{dataset.description && <span className="mr-2">{dataset.description}</span>}Slug <Code>{dataset.slug}</Code></>}
        actions={uploadButton}
      />

      {versions.length === 0 ? (
        <Card>
          <EmptyState title="No items yet" action={uploadButton}>
            Upload a JSONL file with one item per line: <Code>{'{"id": "q1", "input": …, "expected": …}'}</Code>.
            {" "}<Code>input</Code> is required; <Code>id</Code>, <Code>expected</Code> and <Code>metadata</Code> are optional.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-4">
          <div className="space-y-6">
            <Card title="Versions" padded={false}>
              <ul className="divide-y divide-zinc-100">
                {versions.map((v) => (
                  <li key={v.id}>
                    <button type="button" onClick={() => selectVersion(v.version)}
                      className={cx("block w-full px-4 py-2.5 text-left hover:bg-zinc-50", v.id === selected?.id && "bg-brand-50/60")}>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-sm font-medium text-zinc-900">v{v.version}</span>
                        {v.id === latest?.id && <span className="text-xs text-brand-600">latest</span>}
                      </div>
                      <p className="text-xs text-zinc-500">{num(v.itemCount)} items · {dateTime(v.createdAt)}</p>
                      {v.createdBy && <p className="text-xs text-zinc-400">by {v.createdBy}</p>}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            <RunSnippet project={project.slug} dataset={dataset.slug} />
          </div>

          <Card className="lg:col-span-3" padded={false}
            title={selected ? <>Items in <span className="font-mono">v{selected.version}</span></> : "Items"}
            actions={<span className="text-xs text-zinc-500">Versions are immutable</span>}>
            {itemsError ? <div className="p-4"><Alert>{errorMessage(itemsError)}</Alert></div>
              : !items && itemsLoading ? <Loading />
              : items && (
                <>
                  <Table>
                    <thead className="bg-zinc-50">
                      <tr><Th className="w-16">#</Th><Th className="w-40">ID</Th><Th>Input</Th><Th>Expected</Th></tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {items.items.map((it) => <ItemRow key={it.id} item={it} />)}
                    </tbody>
                  </Table>
                  <Pager offset={offset} total={items.total} page={PAGE} onChange={setOffset} />
                </>
              )}
          </Card>
        </div>
      )}

      <UploadModal open={uploading} onClose={() => setUploading(false)} path={`${datasetPath}/versions`}
        onUploaded={async () => {
          await mutate();
          setOffset(0);
          router.replace(pathname); // show the new latest version
          setUploading(false);
        }} />
    </>
  );
}

function ItemRow({ item }: { item: DatasetItem }) {
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <tr className={cx("cursor-pointer hover:bg-zinc-50", open && "bg-zinc-50")} onClick={() => setOpen((o) => !o)}>
        <Td className="text-zinc-500 tabular-nums">{item.position + 1}</Td>
        <Td className="font-mono text-xs text-zinc-700">{item.externalId ?? <span className="text-zinc-400">—</span>}</Td>
        <Td className="max-w-md"><span className="line-clamp-2 font-mono text-xs text-zinc-800">{preview(item.input, 160)}</span></Td>
        <Td className="max-w-xs"><span className="line-clamp-2 font-mono text-xs text-zinc-600">{preview(item.expected, 100)}</span></Td>
      </tr>
      {open && (
        <tr className="bg-zinc-50/60">
          <td colSpan={4} className="px-4 pt-1 pb-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <div><p className="mb-1.5 text-xs font-medium text-zinc-500 uppercase">Input</p><JsonView value={item.input} /></div>
              <div><p className="mb-1.5 text-xs font-medium text-zinc-500 uppercase">Expected</p>
                {item.expected === null ? <p className="text-sm text-zinc-500">None.</p> : <JsonView value={item.expected} />}</div>
              <div><p className="mb-1.5 text-xs font-medium text-zinc-500 uppercase">Metadata</p>
                {Object.keys(item.metadata ?? {}).length === 0 ? <p className="text-sm text-zinc-500">None.</p> : <JsonView value={item.metadata} />}</div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function RunSnippet({ project, dataset }: { project: string; dataset: string }) {
  const snippet = `curl -X POST ${API_URL}/v1/runs \\
  -H "Authorization: Bearer $REVAL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"project":"${project}","dataset":"${dataset}"}'`;
  return (
    <Card title="Run against it" actions={<CopyButton text={snippet} />}>
      <p className="mb-2 text-xs text-zinc-600">Client packages start a run with these slugs. The raw API call:</p>
      <pre className="overflow-x-auto rounded-md bg-zinc-900 p-3 font-mono text-[11px] leading-relaxed text-zinc-100">{snippet}</pre>
    </Card>
  );
}

/**
 * Accepts JSONL (one item per line), a JSON array of items, or { "items": [...] }.
 * JSON is sent as { items }, anything else as raw JSONL so the API reports line numbers.
 */
function toUploadBody(text: string, filename?: string): NonNullable<RequestOptions["body"]> {
  const trimmed = text.trim();
  const looksJson = filename?.toLowerCase().endsWith(".json") || trimmed.startsWith("[");
  if (looksJson || (trimmed.startsWith("{") && !trimmed.includes("\n"))) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return { json: { items: parsed } };
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)) return { json: parsed };
    } catch { /* fall through to JSONL */ }
  }
  return { text, contentType: "application/x-ndjson" };
}

function UploadModal({ open, onClose, path, onUploaded }: {
  open: boolean; onClose: () => void; path: string; onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function close() {
    setFile(null); setPasted(""); setError(null);
    onClose();
  }

  async function submit() {
    setError(null);
    if (file && file.size > MAX_UPLOAD_BYTES) { setError("File is larger than 50 MB. Split it into several datasets."); return; }
    const text = file ? await file.text() : pasted;
    if (!text.trim()) { setError("Choose a file or paste some items first."); return; }
    setSaving(true);
    try {
      await api<{ version: DatasetVersion }>(path, { body: toUploadBody(text, file?.name) });
      setFile(null); setPasted("");
      onUploaded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const lineCount = pasted.split(/\r?\n/).filter((l) => l.trim()).length;

  return (
    <Modal open={open} onClose={close} title="Upload a new version">
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm text-zinc-600">
          One JSON object per line: <Code>{'{"id"?, "input", "expected"?, "metadata"?}'}</Code>.
          A JSON array or <Code>{'{"items": [...]}'}</Code> also works. Each upload creates a new immutable version.
        </p>
        <label className={cx("flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center",
          file ? "border-brand-500 bg-brand-50/50" : "border-zinc-300 hover:border-zinc-400")}>
          <input type="file" accept=".jsonl,.ndjson,.json,application/json,application/x-ndjson,text/plain" className="sr-only"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }} />
          {file
            ? <><span className="text-sm font-medium text-zinc-900">{file.name}</span><span className="text-xs text-zinc-500">{(file.size / 1024).toFixed(1)} KB · click to change</span></>
            : <><span className="text-sm font-medium text-brand-600">Choose a .jsonl file</span><span className="text-xs text-zinc-500">up to 50 MB · 50,000 items</span></>}
        </label>
        {!file && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-500">…or paste items</p>
            <Textarea rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)}
              placeholder={'{"id": "q1", "input": {"question": "What is 2+2?"}, "expected": "4"}\n{"id": "q2", "input": {"question": "Capital of France?"}, "expected": "Paris"}'} />
            {lineCount > 0 && <p className="mt-1 text-xs text-zinc-500">{num(lineCount)} non-empty lines</p>}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
          <Button type="button" loading={saving} onClick={submit}>Upload</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function DatasetPage() {
  return <Suspense fallback={<Loading />}><DatasetView /></Suspense>;
}
