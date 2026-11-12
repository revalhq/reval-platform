import Link from "next/link";
import type { ReactNode } from "react";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight text-zinc-900 ${className ?? ""}`}>
      <span className="grid size-6 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white">R</span>
      Reval
    </span>
  );
}

export function AuthCard({ title, subtitle, children, footer }: {
  title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8"><Logo className="text-lg" /></Link>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
        <h1 className="text-lg font-semibold text-zinc-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-600">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <p className="mt-6 text-sm text-zinc-600">{footer}</p>}
    </main>
  );
}
