"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx, PageHeader } from "@/components/ui";
import { useOrg } from "@/lib/hooks";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { href } = useOrg();
  const pathname = usePathname();
  const tabs = [
    { label: "General", href: href("/settings") },
    { label: "Members", href: href("/settings/members") },
    { label: "API keys", href: href("/settings/api-keys") },
    { label: "Billing", href: href("/settings/billing") },
  ];
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mb-6 border-b border-zinc-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href}
              className={cx("border-b-2 px-0.5 pb-2.5 text-sm font-medium",
                pathname === t.href ? "border-brand-600 text-brand-700" : "border-transparent text-zinc-600 hover:border-zinc-300 hover:text-zinc-900")}>
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </>
  );
}
