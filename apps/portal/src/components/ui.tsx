"use client";

import Link from "next/link";
import {
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes, useEffect, useRef, useState,
} from "react";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// ------------------------------------------------------------------ buttons & inputs

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-white text-zinc-800 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50 shadow-sm",
  danger: "bg-white text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50 shadow-sm",
  ghost: "text-zinc-700 hover:bg-zinc-100",
};

export function Button({
  variant = "primary", size = "md", loading, className, children, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        VARIANTS[variant], className,
      )}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

const fieldClass =
  "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm ring-1 ring-inset " +
  "ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-brand-500 disabled:bg-zinc-50";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldClass, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(fieldClass, "font-mono text-xs", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(fieldClass, "pr-8", props.className)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-zinc-800">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

// ------------------------------------------------------------------ layout

export function PageHeader({ title, description, actions, crumbs }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: { label: string; href?: string }[];
}) {
  return (
    <div className="mb-6">
      {crumbs && crumbs.length > 0 && (
        <nav className="mb-2 flex flex-wrap items-center gap-1 text-sm text-zinc-500">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-zinc-300">/</span>}
              {c.href ? <Link href={c.href} className="hover:text-zinc-900">{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
          {description && <div className="mt-1 text-sm text-zinc-600">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean;
}) {
  return (
    <section className={cx("rounded-lg bg-white shadow-sm ring-1 ring-zinc-200", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          {actions}
        </header>
      )}
      <div className={padded ? "p-4" : undefined}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-sm font-semibold text-zinc-900">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-zinc-600">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "error", children, action }: {
  tone?: "error" | "warning" | "info" | "success"; children: ReactNode; action?: ReactNode;
}) {
  const tones = {
    error: "bg-red-50 text-red-800 ring-red-200",
    warning: "bg-amber-50 text-amber-900 ring-amber-200",
    info: "bg-brand-50 text-brand-700 ring-brand-100",
    success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"}
      className={cx("flex flex-wrap items-center justify-between gap-3 rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset", tones[tone])}>
      <div>{children}</div>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className ?? "size-4")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500">
      <Spinner /> {label}
    </div>
  );
}

export function Badge({ children, tone = "zinc", className }: {
  children: ReactNode; tone?: "zinc" | "brand" | "green" | "red" | "amber" | "blue"; className?: string;
}) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-700 ring-zinc-200",
    brand: "bg-brand-50 text-brand-700 ring-brand-100",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    blue: "bg-sky-50 text-sky-700 ring-sky-200",
  };
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ tables

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-zinc-200 text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cx("px-4 py-2.5 text-left text-xs font-medium tracking-wide text-zinc-500 uppercase", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx("px-4 py-3 align-middle", className)}>{children}</td>;
}

// ------------------------------------------------------------------ misc

export function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose}
      className="m-auto w-full max-w-lg rounded-lg bg-white p-0 shadow-xl ring-1 ring-zinc-200">
      {open && (
        <div className="p-5">
          <h2 className="mb-4 text-base font-semibold text-zinc-900">{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button type="button" variant="secondary" size="sm" onClick={async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch { /* clipboard blocked; text is selectable */ }
    }}>
      {copied ? "Copied" : label}
    </Button>
  );
}

export function JsonView({ value, className }: { value: unknown; className?: string }) {
  const text = value === undefined ? "undefined" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre className={cx("max-h-80 overflow-auto rounded-md bg-zinc-50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-zinc-800 ring-1 ring-zinc-200 ring-inset", className)}>
      {text}
    </pre>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-800">{children}</code>;
}

/** Re-render every `ms` so relative times and live durations stay fresh. */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function Pager({ offset, total, page, onChange }: { offset: number; total: number; page: number; onChange: (o: number) => void }) {
  if (total <= page) return null;
  return (
    <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 text-sm text-zinc-600">
      <span className="tabular-nums">{(offset + 1).toLocaleString()}–{Math.min(offset + page, total).toLocaleString()} of {total.toLocaleString()}</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - page))}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={offset + page >= total} onClick={() => onChange(offset + page)}>Next</Button>
      </div>
    </div>
  );
}
