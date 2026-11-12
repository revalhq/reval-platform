"use client";

import type { AttemptStatus, Progress, Run, RunStatus } from "@/lib/types";
import { num, pct, scalar } from "@/lib/format";
import { Badge, cx } from "./ui";

// ------------------------------------------------------------------ status icons

function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" className={cx("size-3.5", className)} aria-hidden>
      <path d={d} />
    </svg>
  );
}
const CHECK = "M3.5 8.5l3 3 6-7";
const CROSS = "M4.5 4.5l7 7m0-7l-7 7";
const CLOCK = "M8 4.5V8l2.5 1.5M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0z";
const SLASH = "M3.8 12.2l8.4-8.4M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0z";
const WARN = "M8 5.5v3m0 2.5h.01M7.1 2.6L1.7 12a1 1 0 0 0 .9 1.5h10.8a1 1 0 0 0 .9-1.5L8.9 2.6a1 1 0 0 0-1.8 0z";

function Pulse() {
  return (
    <span className="relative flex size-2.5" aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-60" />
      <span className="relative inline-flex size-2.5 rounded-full bg-sky-500" />
    </span>
  );
}

// ------------------------------------------------------------------ run status

/**
 * A "completed" run can still contain errored or abandoned attempts, so the badge reflects
 * the outcome: passed (all succeeded), failed (none succeeded) or partial.
 */
export function runOutcome(run: Pick<Run, "status" | "progress">):
  "queued" | "running" | "passed" | "partial" | "failed" | "cancelled" {
  if (run.status !== "completed") return run.status;
  const p = run.progress;
  const bad = p.errored + p.abandoned + p.cancelled;
  if (bad === 0) return "passed";
  if (p.succeeded === 0) return "failed";
  return "partial";
}

const OUTCOME_STYLE = {
  queued: { tone: "zinc", label: "Queued", icon: <Icon d={CLOCK} /> },
  running: { tone: "blue", label: "Running", icon: <Pulse /> },
  passed: { tone: "green", label: "Passed", icon: <Icon d={CHECK} /> },
  partial: { tone: "amber", label: "Completed with errors", icon: <Icon d={WARN} /> },
  failed: { tone: "red", label: "Failed", icon: <Icon d={CROSS} /> },
  cancelled: { tone: "zinc", label: "Cancelled", icon: <Icon d={SLASH} /> },
} as const;

export function RunStatusBadge({ run, className }: { run: Pick<Run, "status" | "progress">; className?: string }) {
  const s = OUTCOME_STYLE[runOutcome(run)];
  return <Badge tone={s.tone} className={cx("whitespace-nowrap", className)}>{s.icon}{s.label}</Badge>;
}

export const isActive = (status: RunStatus) => status === "queued" || status === "running";

// ------------------------------------------------------------------ attempt status

export const ATTEMPT_STYLE: Record<AttemptStatus, { tone: "zinc" | "blue" | "green" | "red" | "amber"; bar: string; label: string }> = {
  succeeded: { tone: "green", bar: "bg-emerald-500", label: "Succeeded" },
  errored: { tone: "red", bar: "bg-red-500", label: "Errored" },
  abandoned: { tone: "amber", bar: "bg-amber-400", label: "Abandoned" },
  cancelled: { tone: "zinc", bar: "bg-zinc-400", label: "Cancelled" },
  leased: { tone: "blue", bar: "bg-sky-400", label: "In progress" },
  pending: { tone: "zinc", bar: "bg-zinc-200", label: "Pending" },
};
export const ATTEMPT_ORDER: AttemptStatus[] = ["succeeded", "errored", "abandoned", "cancelled", "leased", "pending"];

export function AttemptStatusBadge({ status }: { status: AttemptStatus }) {
  const s = ATTEMPT_STYLE[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

// ------------------------------------------------------------------ progress

export function ProgressBar({ progress, className, height = "h-2" }: { progress: Progress; className?: string; height?: string }) {
  const total = progress.total || 1;
  const title = ATTEMPT_ORDER.filter((s) => progress[s] > 0)
    .map((s) => `${ATTEMPT_STYLE[s].label}: ${num(progress[s])}`).join(" · ");
  return (
    <div className={cx("flex w-full overflow-hidden rounded-full bg-zinc-100", height, className)} title={title}
      role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
      {ATTEMPT_ORDER.map((s) => progress[s] > 0 && (
        <div key={s} className={cx(ATTEMPT_STYLE[s].bar, "h-full transition-[width] duration-500")}
          style={{ width: `${(progress[s] / total) * 100}%` }} />
      ))}
    </div>
  );
}

export function ProgressLegend({ progress, onSelect, selected }: {
  progress: Progress; onSelect?: (s: AttemptStatus | undefined) => void; selected?: AttemptStatus;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-600">
      {ATTEMPT_ORDER.filter((s) => progress[s] > 0 || s === "succeeded" || s === "errored").map((s) => {
        const content = (
          <>
            <span className={cx("size-2 rounded-full", ATTEMPT_STYLE[s].bar)} />
            {ATTEMPT_STYLE[s].label}
            <span className="font-medium text-zinc-900 tabular-nums">{num(progress[s])}</span>
            <span className="text-zinc-400 tabular-nums">({pct(progress[s], progress.total)})</span>
          </>
        );
        return onSelect ? (
          <button key={s} type="button" onClick={() => onSelect(selected === s ? undefined : s)}
            className={cx("flex items-center gap-1.5 rounded px-1 -mx-1 hover:bg-zinc-100", selected === s && "bg-zinc-100 ring-1 ring-zinc-300")}>
            {content}
          </button>
        ) : <span key={s} className="flex items-center gap-1.5">{content}</span>;
      })}
    </div>
  );
}

// ------------------------------------------------------------------ config, tags, trigger

export function ConfigChips({ config, max = 4 }: { config: Record<string, unknown>; max?: number }) {
  const entries = Object.entries(config);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.slice(0, max).map(([k, v]) => (
        <span key={k} className="inline-flex max-w-56 items-center truncate rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700"
          title={`${k} = ${scalar(v)}`}>
          <span className="text-zinc-500">{k}=</span>{scalar(v)}
        </span>
      ))}
      {entries.length > max && <span className="px-1 text-[11px] text-zinc-500">+{entries.length - max}</span>}
    </div>
  );
}

export function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
    </div>
  );
}

/** "node 0.1.0 · CI" from { client: "node", version: "0.1.0", ci: true } */
export function triggerLabel(trigger: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const client = trigger.client ?? trigger.sdk ?? trigger.source;
  if (typeof client === "string") parts.push(typeof trigger.version === "string" ? `${client} ${trigger.version}` : client);
  if (trigger.ci === true) parts.push("CI");
  else if (typeof trigger.ci === "string") parts.push(trigger.ci);
  return parts.length ? parts.join(" · ") : null;
}
