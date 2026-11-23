import Link from "next/link";
import { Logo } from "./auth-card";

const linkClass = "rounded-md px-2.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900";

/** Header for public pages (landing, docs). */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href="/"><Logo /></Link>
        <nav className="ml-4 flex items-center gap-1">
          <Link href="/docs" className={linkClass}>Docs</Link>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          {signedIn ? (
            <Link href="/" className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              Open portal
            </Link>
          ) : (
            <>
              <Link href="/login" className={linkClass}>Log in</Link>
              <Link href="/register" className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
