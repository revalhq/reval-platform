"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useState } from "react";
import useSWR from "swr";
import {
  AttemptStatusBadge, ConfigChips, isActive, ProgressBar, ProgressLegend, RunStatusBadge, Tags, triggerLabel,
} from "@/components/run-ui";
import {
  Alert, Badge, Button, Card, cx, EmptyState, JsonView, Loading, PageHeader, Pager, Select, Table, Td, Th, useNow,
} from "@/components/ui";
import { api, ApiError, errorMessage, withQuery } from "@/lib/api";
import { between, dateTime, duration, num, preview, scalar, timeAgo } from "@/lib/format";
import { useOrg } from "@/lib/hooks";
import { formatMeta, metaLabel, orderMetaKeys, USAGE_KEYS, usageLine } from "@/lib/usage";
import type { Attempt, AttemptStatus, MatrixRow, RunDetail, RunVariant, VariantStats } from "@/lib/types";

const PAGE = 50;
const MATRIX_PAGE = 25;

const toMs = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));
const successRate = (p: { succeeded: number; done: number }) => (p.done ? p.succeeded / p.done : null);

export default function RunPage() {
  const { number } = useParams<{ number: string }>();
  const { orgApi, href, org } = useOrg();
  const now = useNow(1_000);
  const [view, setView] = useState<"compare" | "attempts">("compare");
  const [statusFilter, setStatusFilter] = useState<AttemptStatus | undefined>();
  const [variantFilter, setVariantFilter] = useState<string | undefined>();
  const [offset, setOffset] = useState(0);
  const [matrixOffset, setMatrixOffset] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const runKey = orgApi(`/runs/${number}`);
  const { data, error, mutate } = useSWR<RunDetail>(runKey, {
    refreshInterval: (d) => (d && isActive(d.run.status) ? 2_000 : 0),
  });
  const active = data ? isActive(data.run.status) : false;
  const multi = (data?.run.variants.length ?? 0) > 1;
  const showMatrix = multi && view === "compare";

  const attemptsKey = data && !showMatrix
    ? withQuery(`${runKey}/attempts`, { status: statusFilter, variantId: variantFilter, offset, limit: PAGE }) : null;
  const { data: attempts, error: attemptsError, isLoading: attemptsLoading, mutate: mutateAttempts } =
    useSWR<{ attempts: Attempt[]; total: number }>(attemptsKey, {
      refreshInterval: active ? 3_000 : 0, keepPreviousData: true,
    });

  const matrixKey = data && showMatrix ? withQuery(`${runKey}/matrix`, { offset: matrixOffset, limit: MATRIX_PAGE }) : null;
  const { data: matrix, error: matrixError, isLoading: matrixLoading, mutate: mutateMatrix } =
    useSWR<{ variants: RunVariant[]; rows: MatrixRow[]; total: number }>(matrixKey, {
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
      await Promise.all([mutate(), attemptsKey ? mutateAttempts() : null, matrixKey ? mutateMatrix() : null]);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setCancelling(false);
    }
  }

  function filterBy(s: AttemptStatus | undefined, variantId = variantFilter) {
    setStatusFilter(s);
    setVariantFilter(variantId);
    setOffset(0);
    if (s || variantId) setView("attempts"); // filters apply to the attempt list
  }

  const elapsed = between(run.startedAt, run.finishedAt ?? (active ? null : run.lastActivityAt), now);
  const trig = triggerLabel(run.trigger);
  const configEntries = Object.entries(run.config);
  const hasConfig = multi ? run.variants.some((v) => Object.keys(v.config).length > 0) : configEntries.length > 0;
  const showRepeat = run.repeats > 1;
  const variantName = variantFilter ? run.variants.find((v) => v.id === variantFilter)?.name : undefined;
  // Run-wide usage totals (cost, tokens) summed over the variants.
  const usageTotals = Object.keys(USAGE_KEYS).flatMap((k) => {
    const parts = stats.variants.map((s) => s.metadataTotals[k]).filter((m) => m !== undefined);
    return parts.length ? [{ key: k, sum: parts.reduce((t, m) => t + m.sum, 0) }] : [];
  });

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
            {multi && <><span className="text-zinc-300">·</span><span>comparing {run.variants.length} variants</span></>}
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
          <div className="mt-3"><ProgressLegend progress={run.progress} onSelect={(s) => filterBy(s)} selected={statusFilter} /></div>
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4 text-sm sm:grid-cols-4">
            <Stat label="Duration" value={duration(elapsed)} live={active && Boolean(run.startedAt)} />
            <Stat label="Latency p50" value={duration(toMs(stats.latencyP50))} />
            <Stat label="Latency p95" value={duration(toMs(stats.latencyP95))} />
            <Stat label="Success rate" value={run.progress.done ? `${Math.round((run.progress.succeeded / run.progress.done) * 100)}%` : "—"} />
            {usageTotals.map((u) => <Stat key={u.key} label={metaLabel(u.key)} value={formatMeta(u.key, u.sum)} />)}
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
            {multi && <><Dt>Variants</Dt><Dd>{run.variants.length}, run side by side per item</Dd></>}
            <Dt>Repeats</Dt><Dd>{run.repeats}× per item{multi && " and variant"}</Dd>
            <Dt>Timeout</Dt><Dd>{duration(run.timeoutMs)} per attempt</Dd>
            <Dt>Started</Dt><Dd>{dateTime(run.startedAt)}</Dd>
            <Dt>Finished</Dt><Dd>{dateTime(run.finishedAt)}</Dd>
            <Dt>Last activity</Dt><Dd>{run.lastActivityAt ? timeAgo(run.lastActivityAt, now) : "—"}</Dd>
          </dl>
        </Card>

        {multi && (
          <Card title="Variants" className="lg:col-span-3" padded={false}
            actions={<span className="text-xs text-zinc-500">Every variant ran the same items at the same time</span>}>
            <VariantsTable variants={run.variants} stats={stats.variants}
              onSelect={(id) => filterBy(statusFilter, id)} />
          </Card>
        )}

        {(hasConfig || Object.keys(run.trigger).length > 0) && (
          <Card title="Configuration" className="lg:col-span-3">
            <div className={cx("grid gap-6", multi ? "xl:grid-cols-[2fr_1fr]" : "md:grid-cols-2")}>
              <div className="min-w-0">
                <p className="mb-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                  {multi ? "Config per variant" : "Config under test"}
                </p>
                {multi ? <ConfigCompare variants={run.variants} />
                  : configEntries.length === 0 ? <p className="text-sm text-zinc-500">None reported.</p> : (
                    <dl className="divide-y divide-zinc-100 rounded-md ring-1 ring-zinc-200">
                      {configEntries.map(([k, v]) => (
                        <div key={k} className="grid grid-cols-[minmax(6rem,12rem)_1fr] gap-3 px-3 py-1.5 text-sm">
                          <dt className="truncate font-mono text-xs leading-5 text-zinc-500" title={k}>{k}</dt>
                          <dd className="font-mono text-xs leading-5 [overflow-wrap:anywhere] text-zinc-900"><ConfigValue value={scalar(v)} /></dd>
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
        title={
          <span className="flex flex-wrap items-center gap-2">
            {multi ? (
              <span className="inline-flex rounded-md bg-zinc-100 p-0.5 text-sm font-medium">
                {(["compare", "attempts"] as const).map((v) => (
                  <button key={v} type="button" onClick={() => setView(v)}
                    className={cx("rounded px-2.5 py-1", view === v ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900")}>
                    {v === "compare" ? "Compare" : "All attempts"}
                  </button>
                ))}
              </span>
            ) : "Attempts"}
            {!showMatrix && statusFilter && (
              <Badge>{statusFilter}<button aria-label="Clear status filter" onClick={() => filterBy(undefined)} className="ml-0.5 text-zinc-400 hover:text-zinc-700">×</button></Badge>
            )}
            {!showMatrix && variantName && (
              <Badge>{variantName}<button aria-label="Clear variant filter" onClick={() => filterBy(statusFilter, undefined)} className="ml-0.5 text-zinc-400 hover:text-zinc-700">×</button></Badge>
            )}
          </span>
        }
        actions={
          showMatrix
            ? matrix && <span className="text-xs text-zinc-500 tabular-nums">{num(matrix.total)} {showRepeat ? "item × repeat rows" : "items"}</span>
            : (
              <span className="flex items-center gap-3">
                {multi && (
                  <Select aria-label="Filter by variant" value={variantFilter ?? ""} className="w-40"
                    onChange={(e) => filterBy(statusFilter, e.target.value || undefined)}>
                    <option value="">All variants</option>
                    {run.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </Select>
                )}
                {attempts && <span className="text-xs whitespace-nowrap text-zinc-500 tabular-nums">{num(attempts.total)} total</span>}
              </span>
            )
        }>
        {showMatrix ? (
          matrixError ? <div className="p-4"><Alert>{errorMessage(matrixError)}</Alert></div>
            : !matrix && matrixLoading ? <Loading />
            : !matrix || matrix.rows.length === 0 ? <EmptyState title="No items" />
            : (
              <>
                <Table>
                  <thead className="bg-zinc-50">
                    <tr>
                      <Th className="w-8" />
                      <Th>Item</Th>
                      {showRepeat && <Th className="w-20">Repeat</Th>}
                      {matrix.variants.map((v) => <Th key={v.id} className="min-w-48"><span className="normal-case">{v.name}</span></Th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {matrix.rows.map((r) => (
                      <MatrixRowView key={`${r.item.id}:${r.repeatIndex}`} row={r} variants={matrix.variants} showRepeat={showRepeat}
                        colSpan={2 + (showRepeat ? 1 : 0) + matrix.variants.length} />
                    ))}
                  </tbody>
                </Table>
                <Pager offset={matrixOffset} total={matrix.total} page={MATRIX_PAGE} onChange={setMatrixOffset} />
              </>
            )
        ) : attemptsError ? <div className="p-4"><Alert>{errorMessage(attemptsError)}</Alert></div>
          : !attempts && attemptsLoading ? <Loading />
          : !attempts || attempts.attempts.length === 0 ? <EmptyState title={statusFilter ? `No ${statusFilter} attempts` : "No attempts"} />
          : (
            <>
              <Table>
                <thead className="bg-zinc-50">
                  <tr>
                    <Th className="w-8" />
                    <Th>Item</Th>
                    {multi && <Th className="w-32">Variant</Th>}
                    {showRepeat && <Th className="w-20">Repeat</Th>}
                    <Th className="w-32">Status</Th>
                    <Th className="w-24 text-right">Latency</Th>
                    <Th>Output</Th>
                    <Th>Metadata</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {attempts.attempts.map((a) => (
                    <AttemptRow key={a.id} attempt={a} showRepeat={showRepeat} showVariant={multi}
                      colSpan={6 + (showRepeat ? 1 : 0) + (multi ? 1 : 0)} />
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

// ------------------------------------------------------------------ variant comparison

const MAX_META_COLUMNS = 5;

/** Per-variant summary. Marks the best success rate and lowest latencies when variants differ. */
function VariantsTable({ variants, stats, onSelect }: {
  variants: RunVariant[]; stats: VariantStats[]; onSelect: (variantId: string) => void;
}) {
  const byId = new Map(stats.map((s) => [s.variantId, s]));
  const metaKeys = orderMetaKeys(stats.flatMap((s) => Object.keys(s.metadataTotals))).slice(0, MAX_META_COLUMNS);

  const best = (values: (number | null)[], pick: (xs: number[]) => number) => {
    const xs = values.filter((x): x is number => x !== null);
    return xs.length > 1 && new Set(xs).size > 1 ? pick(xs) : null;
  };
  const bestSuccess = best(stats.map((s) => successRate(s.progress)), (xs) => Math.max(...xs));
  const bestP50 = best(stats.map((s) => s.latencyP50), (xs) => Math.min(...xs));
  const bestP95 = best(stats.map((s) => s.latencyP95), (xs) => Math.min(...xs));
  // Lowest total is "best" only for keys where that's clearly true (cost), not for token counts.
  const bestMeta = Object.fromEntries(metaKeys.filter((k) => USAGE_KEYS[k]?.lowerIsBetter)
    .map((k) => [k, best(stats.map((s) => s.metadataTotals[k]?.sum ?? null), (xs) => Math.min(...xs))]));
  const Best = ({ on, children }: { on: boolean; children: React.ReactNode }) =>
    <span className={cx(on && "font-semibold text-emerald-700")} title={on ? "Best of the variants" : undefined}>{children}</span>;

  return (
    <Table>
      <thead className="bg-zinc-50">
        <tr>
          <Th>Variant</Th>
          <Th className="w-56">Progress</Th>
          <Th className="w-24 text-right">Success</Th>
          <Th className="w-24 text-right">p50</Th>
          <Th className="w-24 text-right">p95</Th>
          {metaKeys.map((k) => (
            <Th key={k} className="text-right">
              {k in USAGE_KEYS ? metaLabel(k) : <span className="font-mono normal-case">{k}</span>}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100">
        {variants.map((v) => {
          const s = byId.get(v.id);
          if (!s) return null;
          const rate = successRate(s.progress);
          return (
            <tr key={v.id}>
              <Td>
                <button type="button" onClick={() => onSelect(v.id)} className="font-mono text-sm font-medium text-brand-600 hover:text-brand-700"
                  title="Show this variant's attempts">
                  {v.name}
                </button>
                <div className="mt-1"><ConfigChips config={v.config} max={3} /></div>
              </Td>
              <Td>
                <ProgressBar progress={s.progress} />
                <div className="mt-1 flex justify-between text-xs text-zinc-500 tabular-nums">
                  <span>{num(s.progress.done)} / {num(s.progress.total)}</span>
                  {s.progress.errored + s.progress.abandoned > 0 && (
                    <span className="text-red-600">{num(s.progress.errored + s.progress.abandoned)} failed</span>
                  )}
                </div>
              </Td>
              <Td className="text-right tabular-nums">
                <Best on={rate !== null && rate === bestSuccess}>{rate === null ? "—" : `${Math.round(rate * 100)}%`}</Best>
              </Td>
              <Td className="text-right tabular-nums"><Best on={s.latencyP50 !== null && s.latencyP50 === bestP50}>{duration(s.latencyP50)}</Best></Td>
              <Td className="text-right tabular-nums"><Best on={s.latencyP95 !== null && s.latencyP95 === bestP95}>{duration(s.latencyP95)}</Best></Td>
              {metaKeys.map((k) => {
                const m = s.metadataTotals[k];
                return (
                  <Td key={k} className="text-right tabular-nums">
                    {m ? (
                      <>
                        <div className="text-zinc-900" title="Total over finished attempts">
                          <Best on={bestMeta[k] !== undefined && bestMeta[k] !== null && m.sum === bestMeta[k]}>{formatMeta(k, m.sum)}</Best>
                        </div>
                        <div className="text-[11px] whitespace-nowrap text-zinc-500" title={`Average over ${m.count} attempts that reported it`}>avg {formatMeta(k, m.sum / m.count)}</div>
                      </>
                    ) : <span className="text-zinc-400">—</span>}
                  </Td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

/** Config keys as rows, variants as columns; values that differ between variants are highlighted. */
function ConfigCompare({ variants }: { variants: RunVariant[] }) {
  const keys = [...new Set(variants.flatMap((v) => Object.keys(v.config)))];
  if (keys.length === 0) return <p className="text-sm text-zinc-500">None reported.</p>;
  return (
    <div className="overflow-x-auto rounded-md ring-1 ring-zinc-200">
      <table className="min-w-full divide-y divide-zinc-100 text-xs">
        <thead className="bg-zinc-50">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium text-zinc-500">Key</th>
            {variants.map((v) => <th key={v.id} className="px-3 py-1.5 text-left font-mono font-medium text-zinc-700">{v.name}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {keys.map((k) => {
            const values = variants.map((v) => (k in v.config ? scalar(v.config[k]) : undefined));
            const differs = new Set(values).size > 1;
            return (
              <tr key={k} className="align-top">
                <td className="px-3 py-1.5 font-mono text-zinc-500">{k}</td>
                {values.map((x, i) => (
                  <td key={variants[i]!.id} className={cx("px-3 py-1.5 font-mono [overflow-wrap:anywhere]", differs ? "bg-amber-50 text-zinc-900" : "text-zinc-700")}>
                    {x === undefined ? <span className="text-zinc-400">—</span> : <ConfigValue value={x} />}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Values longer than this (e.g. a system prompt) start clamped to three lines. */
const LONG_VALUE = 120;

/** A config value; long ones get a "Show more" / "Show less" toggle right under the text. */
function ConfigValue({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  if (value.length <= LONG_VALUE) return <>{value}</>;
  return (
    <>
      <div className={cx(!open && "line-clamp-3")}>{value}</div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="mt-1 font-sans text-[11px] font-medium text-brand-600 hover:text-brand-700">
        {open ? "Show less" : "Show more"}
      </button>
    </>
  );
}

function MatrixRowView({ row, variants, showRepeat, colSpan }: {
  row: MatrixRow; variants: RunVariant[]; showRepeat: boolean; colSpan: number;
}) {
  const [open, setOpen] = useState(false);
  const byVariant = new Map(row.attempts.map((a) => [a.variant.id, a]));
  const leased = row.attempts.map((a) => a.leasedAt).filter((x): x is string => Boolean(x)).map((x) => new Date(x).getTime());
  const spread = leased.length > 1 ? Math.max(...leased) - Math.min(...leased) : null;

  return (
    <Fragment>
      <tr className={cx("cursor-pointer align-top hover:bg-zinc-50", open && "bg-zinc-50")} onClick={() => setOpen((o) => !o)}>
        <Td className="pr-0 text-zinc-400"><Chevron open={open} /></Td>
        <Td>
          <button type="button" className="text-left font-mono text-xs text-zinc-900" aria-expanded={open}>
            {row.item.externalId ?? `#${row.item.position + 1}`}
          </button>
          <div className="max-w-xs truncate text-xs text-zinc-500">{preview(row.item.input, 60)}</div>
        </Td>
        {showRepeat && <Td className="text-zinc-600 tabular-nums">{row.repeatIndex + 1}</Td>}
        {variants.map((v) => {
          const a = byVariant.get(v.id);
          return (
            <Td key={v.id} className="max-w-xs">
              {a && (
                <>
                  <div className="flex items-center gap-2">
                    <AttemptStatusBadge status={a.status} />
                    <span className="text-xs text-zinc-500 tabular-nums">{duration(a.latencyMs)}</span>
                  </div>
                  {a.error
                    ? <span className="mt-1 line-clamp-2 font-mono text-xs text-red-700">{a.error}</span>
                    : <span className="mt-1 line-clamp-2 font-mono text-xs text-zinc-700">{preview(a.output, 100)}</span>}
                  {usageLine(a.metadata) && <div className="mt-1 text-[11px] text-zinc-500 tabular-nums">{usageLine(a.metadata)}</div>}
                </>
              )}
            </Td>
          );
        })}
      </tr>
      {open && (
        <tr className="bg-zinc-50/60">
          <td colSpan={colSpan} className="px-4 pt-1 pb-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Block label="Input"><JsonView value={row.item.input} /></Block>
              <Block label="Expected">
                {row.item.expected === null || row.item.expected === undefined
                  ? <p className="text-sm text-zinc-500">No expected value.</p> : <JsonView value={row.item.expected} />}
              </Block>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {variants.map((v) => {
                const a = byVariant.get(v.id);
                if (!a) return null;
                return (
                  <div key={v.id} className="min-w-0 rounded-md bg-white p-3 ring-1 ring-zinc-200">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium text-zinc-900">{v.name}</span>
                      <AttemptStatusBadge status={a.status} />
                      <span className="text-xs text-zinc-500 tabular-nums">{duration(a.latencyMs)}</span>
                    </div>
                    {a.error ? <JsonView value={a.error} className="bg-red-50 text-red-800 ring-red-200" />
                      : a.output === null || a.output === undefined ? <p className="text-sm text-zinc-500">No output yet.</p>
                      : <JsonView value={a.output} />}
                    {Object.keys(a.metadata ?? {}).length > 0 && <div className="mt-2"><ConfigChips config={a.metadata} max={6} /></div>}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              {spread === null ? "Not started yet."
                : spread < 1000 ? <>All variants were handed out together{leased.length ? <> at {dateTime(new Date(Math.min(...leased)).toISOString())}</> : null}.</>
                : <>Variants started up to {duration(spread)} apart (an attempt was handed out again after its lease expired).</>}
            </p>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// ------------------------------------------------------------------ attempt list

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={cx("size-3.5 transition-transform", open && "rotate-90")} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AttemptRow({ attempt: a, showRepeat, showVariant, colSpan }: {
  attempt: Attempt; showRepeat: boolean; showVariant: boolean; colSpan: number;
}) {
  const [open, setOpen] = useState(false);
  const metaEntries = Object.entries(a.metadata ?? {});
  return (
    <Fragment>
      <tr className={cx("cursor-pointer hover:bg-zinc-50", open && "bg-zinc-50")} onClick={() => setOpen((o) => !o)}>
        <Td className="pr-0 text-zinc-400"><Chevron open={open} /></Td>
        <Td>
          <button type="button" className="text-left font-mono text-xs text-zinc-900" aria-expanded={open}>
            {a.item.externalId ?? `#${a.item.position + 1}`}
          </button>
          <div className="max-w-xs truncate text-xs text-zinc-500">{preview(a.item.input, 60)}</div>
        </Td>
        {showVariant && <Td className="font-mono text-xs whitespace-nowrap text-zinc-700">{a.variant.name}</Td>}
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
              {showVariant && <> · variant <span className="font-mono">{a.variant.name}</span></>}
              {a.leasedAt && <> · started {dateTime(a.leasedAt)}</>}
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
