"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useState } from "react";
import useSWR from "swr";
import {
  AttemptStatusBadge, ConfigChips, isActive, ProgressBar, ProgressLegend, RunStatusBadge, Tags, triggerLabel,
} from "@/components/run-ui";
import {
  Alert, Badge, Button, Card, cx, EmptyState, JsonView, Loading, PageHeader, Pager, Table, Td, Th, useNow,
} from "@/components/ui";
import { api, ApiError, errorMessage, withQuery } from "@/lib/api";
import { between, dateTime, duration, num, preview, scalar, timeAgo } from "@/lib/format";
import { useOrg } from "@/lib/hooks";
import type { Attempt, AttemptStatus, Run } from "@/lib/types";

interface RunDetail { run: Run; stats: { latencyP50: number | string | null; latencyP95: number | string | null } }
const PAGE = 50;

const toMs = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));

export default function RunPage() {
  const { number } = useParams<{ number: string }>();
  const { orgApi, href, org } = useOrg();
  const now = useNow(1_000);
  const [statusFilter, setStatusFilter] = useState<AttemptStatus | undefined>();
  const [offset, setOffset] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const runKey = orgApi(`/runs/${number}`);
  const { data, error, mutate } = useSWR<RunDetail>(runKey, {
    refreshInterval: (d) => (d && isActive(d.run.status) ? 2_000 : 0),
  });
  const active = data ? isActive(data.run.status) : false;

  const attemptsKey = data ? withQuery(`${runKey}/attempts`, { status: statusFilter, offset, limit: PAGE }) : null;
  const { data: attempts, error: attemptsError, isLoading: attemptsLoading, mutate: mutateAttempts } =
    useSWR<{ attempts: Attempt[]; total: number }>(attemptsKey, {
      refreshInterval: active ? 3_000 : 0, keepPreviousData: true,
    });

  if (error) {
    return error instanceof ApiError && error.status === 404
      ? <Card><EmptyState title={`Run #${number} not found`} action={<Link href={href("/runs")} className="text-sm font-medium text-brand-600">Back to runs</Link>} /></Card>
      : <Alert>{errorMessage(error)}</Alert>;
  }
  if (!data) return <Loading />;
  const { run, stats } = data;

  async function cancel() {
    if (!confirm(`Cancel run #${run.number}? Pending attempts will be marked cancelled; results already submitted are kept.`)) return;
    setCancelling(true);
    setActionError(null);
    try {
      await api(`${runKey}/cancel`, { method: "POST" });
      await Promise.all([mutate(), mutateAttempts()]);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setCancelling(false);
    }
  }

  function filterBy(s: AttemptStatus | undefined) {
    setStatusFilter(s);
    setOffset(0);
  }

  const elapsed = between(run.startedAt, run.finishedAt ?? (active ? null : run.lastActivityAt), now);
  const trig = triggerLabel(run.trigger);
  const configEntries = Object.entries(run.config);
  const showRepeat = run.repeats > 1;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Runs", href: href("/runs") }, { label: `#${run.number}` }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>{run.name ?? `Run #${run.number}`}</span>
            <RunStatusBadge run={run} className="text-sm" />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>#{run.number}</span><span className="text-zinc-300">·</span>
            <span title={dateTime(run.createdAt)}>created {timeAgo(run.createdAt, now)}</span>
            {trig && <><span className="text-zinc-300">·</span><span>via {trig}</span></>}
            <Tags tags={run.tags} />
          </span>
        }
        actions={active && <Button variant="danger" loading={cancelling} onClick={cancel}>Cancel run</Button>}
      />

      {actionError && <div className="mb-4"><Alert>{actionError}</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Progress" className="lg:col-span-2"
          actions={<span className="text-sm text-zinc-600 tabular-nums">{num(run.progress.done)} of {num(run.progress.total)} attempts done</span>}>
          <ProgressBar progress={run.progress} height="h-3" />
          <div className="mt-3"><ProgressLegend progress={run.progress} onSelect={filterBy} selected={statusFilter} /></div>
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4 text-sm sm:grid-cols-4">
            <Stat label="Duration" value={duration(elapsed)} live={active && Boolean(run.startedAt)} />
            <Stat label="Latency p50" value={duration(toMs(stats.latencyP50))} />
            <Stat label="Latency p95" value={duration(toMs(stats.latencyP95))} />
            <Stat label="Success rate" value={run.progress.done ? `${Math.round((run.progress.succeeded / run.progress.done) * 100)}%` : "—"} />
          </dl>
        </Card>

        <Card title="Details">
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
            <Dt>Project</Dt>
            <Dd><Link className="text-brand-600 hover:text-brand-700" href={href(`/projects/${run.project.slug}`)}>{run.project.name}</Link></Dd>
            <Dt>Dataset</Dt>
            <Dd>
              <Link className="text-brand-600 hover:text-brand-700" href={href(`/projects/${run.project.slug}/datasets/${run.dataset.slug}?version=${run.dataset.version}`)}>
                {run.dataset.name}
              </Link> <span className="font-mono text-xs text-zinc-500">v{run.dataset.version}</span>
            </Dd>
            <Dt>Repeats</Dt><Dd>{run.repeats}× per item</Dd>
            <Dt>Timeout</Dt><Dd>{duration(run.timeoutMs)} per attempt</Dd>
            <Dt>Started</Dt><Dd>{dateTime(run.startedAt)}</Dd>
            <Dt>Finished</Dt><Dd>{dateTime(run.finishedAt)}</Dd>
            <Dt>Last activity</Dt><Dd>{run.lastActivityAt ? timeAgo(run.lastActivityAt, now) : "—"}</Dd>
          </dl>
        </Card>

        {(configEntries.length > 0 || Object.keys(run.trigger).length > 0) && (
          <Card title="Configuration" className="lg:col-span-3">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">Config under test</p>
                {configEntries.length === 0 ? <p className="text-sm text-zinc-500">None reported.</p> : (
                  <dl className="divide-y divide-zinc-100 rounded-md ring-1 ring-zinc-200">
                    {configEntries.map(([k, v]) => (
                      <div key={k} className="grid grid-cols-[minmax(6rem,12rem)_1fr] gap-3 px-3 py-1.5 text-sm">
                        <dt className="truncate font-mono text-xs leading-5 text-zinc-500" title={k}>{k}</dt>
                        <dd className="font-mono text-xs leading-5 break-all text-zinc-900">{scalar(v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">Trigger</p>
                {Object.keys(run.trigger).length === 0 ? <p className="text-sm text-zinc-500">None reported.</p> : <JsonView value={run.trigger} />}
              </div>
            </div>
          </Card>
        )}
      </div>

      <Card className="mt-6" padded={false}
        title={<>Attempts {statusFilter && <Badge className="ml-2">{statusFilter}<button aria-label="Clear filter" onClick={() => filterBy(undefined)} className="ml-0.5 text-zinc-400 hover:text-zinc-700">×</button></Badge>}</>}
        actions={attempts && <span className="text-xs text-zinc-500 tabular-nums">{num(attempts.total)} total</span>}>
        {attemptsError ? <div className="p-4"><Alert>{errorMessage(attemptsError)}</Alert></div>
          : !attempts && attemptsLoading ? <Loading />
          : !attempts || attempts.attempts.length === 0 ? <EmptyState title={statusFilter ? `No ${statusFilter} attempts` : "No attempts"} />
          : (
            <>
              <Table>
                <thead className="bg-zinc-50">
                  <tr>
                    <Th className="w-8" />
                    <Th>Item</Th>
                    {showRepeat && <Th className="w-20">Repeat</Th>}
                    <Th className="w-32">Status</Th>
                    <Th className="w-24 text-right">Latency</Th>
                    <Th>Output</Th>
                    <Th>Metadata</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {attempts.attempts.map((a) => (
                    <AttemptRow key={a.id} attempt={a} showRepeat={showRepeat} colSpan={showRepeat ? 7 : 6} />
                  ))}
                </tbody>
              </Table>
              <Pager offset={offset} total={attempts.total} page={PAGE} onChange={setOffset} />
            </>
          )}
      </Card>
      <p className="mt-3 text-xs text-zinc-500">
        Scoring isn’t available yet. Outputs are stored as-is, so this run can be scored later without re-running it.
        {" "}Run link: <span className="font-mono">/{org.slug}/runs/{run.number}</span>
      </p>
    </>
  );
}

function Stat({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={cx("mt-0.5 text-lg font-semibold text-zinc-900 tabular-nums", live && "text-sky-700")}>{value}</dd>
    </div>
  );
}
const Dt = ({ children }: { children: React.ReactNode }) => <dt className="text-zinc-500">{children}</dt>;
const Dd = ({ children }: { children: React.ReactNode }) => <dd className="min-w-0 text-zinc-900">{children}</dd>;

function AttemptRow({ attempt: a, showRepeat, colSpan }: { attempt: Attempt; showRepeat: boolean; colSpan: number }) {
  const [open, setOpen] = useState(false);
  const metaEntries = Object.entries(a.metadata ?? {});
  return (
    <Fragment>
      <tr className={cx("cursor-pointer hover:bg-zinc-50", open && "bg-zinc-50")} onClick={() => setOpen((o) => !o)}>
        <Td className="pr-0 text-zinc-400">
          <svg viewBox="0 0 16 16" className={cx("size-3.5 transition-transform", open && "rotate-90")} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Td>
        <Td>
          <button type="button" className="text-left font-mono text-xs text-zinc-900" aria-expanded={open}>
            {a.item.externalId ?? `#${a.item.position + 1}`}
          </button>
          <div className="max-w-xs truncate text-xs text-zinc-500">{preview(a.item.input, 60)}</div>
        </Td>
        {showRepeat && <Td className="text-zinc-600 tabular-nums">{a.repeatIndex + 1}</Td>}
        <Td>
          <AttemptStatusBadge status={a.status} />
          {a.leaseCount > 1 && <div className="mt-1 text-[11px] text-zinc-500">{a.leaseCount} leases</div>}
        </Td>
        <Td className="text-right text-zinc-700 tabular-nums">{duration(a.latencyMs)}</Td>
        <Td className="max-w-sm">
          {a.error
            ? <span className="line-clamp-2 font-mono text-xs text-red-700">{a.error}</span>
            : <span className="line-clamp-2 font-mono text-xs text-zinc-700">{preview(a.output, 140)}</span>}
        </Td>
        <Td><ConfigChips config={a.metadata ?? {}} max={3} /></Td>
      </tr>
      {open && (
        <tr className="bg-zinc-50/60">
          <td colSpan={colSpan} className="px-4 pt-1 pb-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Block label="Input"><JsonView value={a.item.input} /></Block>
              <Block label="Expected">
                {a.item.expected === null || a.item.expected === undefined
                  ? <p className="text-sm text-zinc-500">No expected value.</p> : <JsonView value={a.item.expected} />}
              </Block>
              <Block label={a.error ? "Error" : "Output"}>
                {a.error ? <JsonView value={a.error} className="bg-red-50 text-red-800 ring-red-200" />
                  : a.output === null || a.output === undefined ? <p className="text-sm text-zinc-500">No output yet.</p>
                  : <JsonView value={a.output} />}
              </Block>
              <Block label="Metadata">
                {metaEntries.length === 0 ? <p className="text-sm text-zinc-500">None reported.</p> : <JsonView value={a.metadata} />}
              </Block>
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Attempt <span className="font-mono">{a.id}</span>
              {a.completedAt && <> · completed {dateTime(a.completedAt)}</>}
              {a.leaseCount > 0 && <> · leased {a.leaseCount}×</>}
            </p>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
      {children}
    </div>
  );
}
