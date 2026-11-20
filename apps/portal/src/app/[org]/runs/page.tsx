"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import {
  isActive, ProgressBar, RunConfig, RunStatusBadge, Tags, triggerLabel,
} from "@/components/run-ui";
import { Alert, Button, Card, EmptyState, Loading, PageHeader, Select, Table, Td, Th, useNow } from "@/components/ui";
import { withQuery } from "@/lib/api";
import { between, duration, num, timeAgo } from "@/lib/format";
import { useOrg } from "@/lib/hooks";
import type { ApiKey, Project, Run, RunStatus } from "@/lib/types";
import { errorMessage } from "@/lib/api";

const PAGE_SIZE = 25;
const STATUSES: RunStatus[] = ["queued", "running", "completed", "cancelled"];

interface RunsPage { runs: Run[]; nextBefore: number | null }

function RunsList() {
  const { orgApi, href } = useOrg();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = useNow(5_000);

  const projectSlug = params.get("project") ?? "";
  const status = (STATUSES as string[]).includes(params.get("status") ?? "") ? params.get("status")! : "";
  const { data: projectsData } = useSWR<{ projects: Project[] }>(orgApi("/projects"));
  const project = projectsData?.projects.find((p) => p.slug === projectSlug);
  // Wait for the slug → id lookup before querying, so we never flash unfiltered results.
  const ready = !projectSlug || Boolean(projectsData);

  const { data, error, size, setSize, isLoading, isValidating } = useSWRInfinite<RunsPage>(
    (index, prev) => {
      if (!ready) return null;
      if (prev && prev.nextBefore === null) return null;
      return withQuery(orgApi("/runs"), {
        projectId: project?.id, status, limit: PAGE_SIZE, before: index === 0 ? undefined : prev?.nextBefore,
      });
    },
    {
      // Poll quickly while something is in flight; otherwise check for new runs now and then.
      refreshInterval: (latest?: RunsPage[]) => (latest?.some((p) => p.runs.some((r) => isActive(r.status))) ? 3_000 : 15_000),
      revalidateFirstPage: true,
    },
  );

  const runs = data?.flatMap((p) => p.runs) ?? [];
  const hasMore = data ? data[data.length - 1]?.nextBefore !== null : false;
  const filtered = Boolean(projectSlug || status);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <>
      <PageHeader
        title="Runs"
        description="Every evaluation run started by your client packages, newest first."
        actions={
          <div className="flex items-center gap-2">
            <Select aria-label="Filter by project" value={projectSlug} onChange={(e) => setFilter("project", e.target.value)} className="w-44">
              <option value="">All projects</option>
              {projectsData?.projects.map((p) => <option key={p.id} value={p.slug}>{p.name}</option>)}
            </Select>
            <Select aria-label="Filter by status" value={status} onChange={(e) => setFilter("status", e.target.value)} className="w-36">
              <option value="">Any status</option>
              {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s[0]!.toUpperCase() + s.slice(1)}</option>)}
            </Select>
          </div>
        }
      />

      {error && <div className="mb-4"><Alert>{errorMessage(error)}</Alert></div>}

      {projectSlug && projectsData && !project ? (
        <Card><EmptyState title="Unknown project">No project with slug “{projectSlug}”.</EmptyState></Card>
      ) : isLoading || !ready ? (
        <Card><Loading /></Card>
      ) : runs.length === 0 ? (
        filtered
          ? <Card><EmptyState title="No runs match these filters" action={<Button variant="secondary" onClick={() => router.replace(pathname)}>Clear filters</Button>} /></Card>
          : <GettingStarted />
      ) : (
        <Card padded={false}>
          <Table>
            <thead className="bg-zinc-50">
              <tr>
                <Th className="w-44">Status</Th>
                <Th>Run</Th>
                <Th>Project · dataset</Th>
                <Th>Config</Th>
                <Th className="w-56">Progress</Th>
                <Th className="w-32 text-right">Duration</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {runs.map((r) => {
                const link = href(`/runs/${r.number}`);
                const trig = triggerLabel(r.trigger);
                return (
                  <tr key={r.id} className="group cursor-pointer hover:bg-zinc-50" onClick={(e) => {
                    if (!(e.target as HTMLElement).closest("a")) router.push(link);
                  }}>
                    <Td><RunStatusBadge run={r} /></Td>
                    <Td>
                      <Link href={link} className="font-medium text-zinc-900 group-hover:text-brand-600">
                        <span className="text-zinc-500">#{r.number}</span> {r.name ?? <span className="font-normal text-zinc-500 italic">untitled</span>}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                        <span title={r.createdAt}>{timeAgo(r.createdAt, now)}</span>
                        {trig && <><span className="text-zinc-300">·</span><span>{trig}</span></>}
                        <Tags tags={r.tags} />
                      </div>
                    </Td>
                    <Td className="text-zinc-700">
                      <div className="font-medium">{r.project.name}</div>
                      <div className="text-xs text-zinc-500">{r.dataset.name} <span className="font-mono">v{r.dataset.version}</span></div>
                    </Td>
                    <Td><RunConfig run={r} /></Td>
                    <Td>
                      <ProgressBar progress={r.progress} />
                      <div className="mt-1 flex justify-between text-xs text-zinc-500 tabular-nums">
                        <span>{num(r.progress.done)} / {num(r.progress.total)}</span>
                        {r.progress.errored + r.progress.abandoned > 0 && (
                          <span className="text-red-600">{num(r.progress.errored + r.progress.abandoned)} failed</span>
                        )}
                      </div>
                    </Td>
                    <Td className="text-right text-zinc-600 tabular-nums">
                      {duration(between(r.startedAt, r.finishedAt ?? (isActive(r.status) ? null : r.lastActivityAt), now))}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {hasMore && (
            <div className="border-t border-zinc-100 p-3 text-center">
              <Button variant="secondary" loading={isValidating && size > (data?.length ?? 0)} onClick={() => setSize(size + 1)}>
                Load older runs
              </Button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

/** First-run checklist: shown instead of an empty table until the org has a run. */
function GettingStarted() {
  const { orgApi, href, subscriptionActive, can } = useOrg();
  const { data: projects } = useSWR<{ projects: Project[] }>(orgApi("/projects"));
  const { data: keys } = useSWR<{ apiKeys: ApiKey[] }>(orgApi("/api-keys"));
  const steps = [
    { done: subscriptionActive, title: "Activate a subscription", body: "Runs and API keys need an active plan.", link: href("/settings/billing"), cta: "Billing" },
    { done: (projects?.projects.length ?? 0) > 0, title: "Create a project and upload a dataset", body: "Datasets are JSONL files of { input, expected? } items. Versions are immutable.", link: href("/projects"), cta: "Projects" },
    { done: (keys?.apiKeys.some((k) => !k.revokedAt)) ?? false, title: "Create an API key", body: "Your client package uses it to fetch tasks and send results back.", link: href("/settings/api-keys"), cta: "API keys" },
    { done: false, title: "Run the evaluation from your code", body: "Your app runs in your environment. Results show up here live, as they arrive.", link: null, cta: null },
  ];
  return (
    <Card title="Get started">
      <p className="mb-4 text-sm text-zinc-600">
        No runs yet. Reval sends dataset items to your app, records each output, and shows the run here.
        {!can("admin") && " Ask an admin of this organization to set things up."}
      </p>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3 rounded-md p-3 ring-1 ring-zinc-200">
            <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${s.done ? "bg-emerald-500 text-white" : "bg-zinc-100 text-zinc-600"}`}>
              {s.done ? "✓" : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${s.done ? "text-zinc-500 line-through" : "text-zinc-900"}`}>{s.title}</p>
              <p className="text-sm text-zinc-600">{s.body}</p>
            </div>
            {s.link && !s.done && <Link href={s.link} className="shrink-0 text-sm font-medium text-brand-600 hover:text-brand-700">{s.cta} →</Link>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export default function RunsPage() {
  return <Suspense fallback={<Loading />}><RunsList /></Suspense>;
}
