"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { Me, OrgSummary } from "@/lib/types";
import { Logo } from "./auth-card";
import { cx } from "./ui";

function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  return ref;
}

function Menu({ button, children, align = "left" }: { button: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss<HTMLDivElement>(open, close);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100">
        {button}
        <svg viewBox="0 0 16 16" className="size-3.5 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M4.5 6.5L8 10l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className={cx("absolute z-20 mt-1 w-64 rounded-lg bg-white py-1 shadow-lg ring-1 ring-zinc-200", align === "right" ? "right-0" : "left-0")}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

const itemClass = "block w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50";

function OrgSwitcher({ me, current }: { me: Me; current: OrgSummary }) {
  return (
    <Menu button={<span className="max-w-48 truncate">{current.name}</span>}>
      {(close) => (
        <>
          <p className="px-3 pt-1.5 pb-1 text-xs font-medium text-zinc-500">Organizations</p>
          {me.organizations.map((o) => (
            <Link key={o.id} href={`/${o.slug}/runs`} onClick={close}
              className={cx(itemClass, "flex items-center justify-between gap-2")}>
              <span className="truncate">{o.name}</span>
              {o.id === current.id
                ? <span className="text-xs text-brand-600">current</span>
                : <span className="text-xs text-zinc-400 capitalize">{o.role}</span>}
            </Link>
          ))}
        </>
      )}
    </Menu>
  );
}

async function logout() {
  try { await api("/auth/logout", { method: "POST" }); } finally { window.location.assign("/login"); }
}

function UserMenu({ me }: { me: Me }) {
  return (
    <Menu align="right" button={
      <span className="grid size-7 place-items-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700">
        {me.user.name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    }>
      {(close) => (
        <>
          <div className="border-b border-zinc-100 px-3 pt-1.5 pb-2">
            <p className="truncate text-sm font-medium text-zinc-900">{me.user.name}</p>
            <p className="truncate text-xs text-zinc-500">{me.user.email}</p>
          </div>
          <Link href="/account" onClick={close} className={itemClass}>Account</Link>
          <button type="button" onClick={logout} className={itemClass}>Log out</button>
        </>
      )}
    </Menu>
  );
}

export function TopBar({ me, org }: { me: Me; org?: OrgSummary }) {
  const pathname = usePathname();
  const nav = org ? [
    { label: "Runs", href: `/${org.slug}/runs` },
    { label: "Projects", href: `/${org.slug}/projects` },
    { label: "Docs", href: `/${org.slug}/docs` },
    { label: "Settings", href: `/${org.slug}/settings` },
  ] : [];
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href={org ? `/${org.slug}/runs` : "/"}><Logo /></Link>
        {org && <><span className="text-zinc-300">/</span><OrgSwitcher me={me} current={org} /></>}
        <nav className="ml-2 flex items-center gap-1">
          {nav.map((n) => {
            const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
            return (
              <Link key={n.href} href={n.href}
                className={cx("rounded-md px-2.5 py-1.5 text-sm font-medium",
                  active ? "bg-zinc-100 text-zinc-900" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900")}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto"><UserMenu me={me} /></div>
      </div>
    </header>
  );
}

export function Container({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>;
}
