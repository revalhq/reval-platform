import Link from "next/link";
import { Logo } from "@/components/auth-card";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo className="text-lg" />
      <h1 className="text-lg font-semibold text-zinc-900">Page not found</h1>
      <Link href="/" className="text-sm font-medium text-brand-600 hover:text-brand-700">Go to your dashboard</Link>
    </main>
  );
}
