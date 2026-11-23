import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Logo } from "@/components/auth-card";
import { Docs } from "@/components/docs";
import { Container } from "@/components/shell";

// Must match SESSION_COOKIE in apps/api/src/plugins/auth.ts (and src/proxy.ts).
const SESSION_COOKIE = "rv_session";

export const metadata: Metadata = { title: "Documentation" };

/** Public documentation: readable without an account. Signed-in users also get it at /[org]/docs. */
export default async function PublicDocsPage() {
  const signedIn = Boolean((await cookies()).get(SESSION_COOKIE)?.value);
  const linkClass = "rounded-md px-2.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900";

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link href="/"><Logo /></Link>
          <span className="text-zinc-300">/</span>
          <span className="text-sm font-medium text-zinc-800">Docs</span>
          <nav className="ml-auto flex items-center gap-1">
            {signedIn ? (
              <Link href="/" className={linkClass}>Open portal</Link>
            ) : (
              <>
                <Link href="/login" className={linkClass}>Log in</Link>
                <Link href="/register" className="rounded-md bg-brand-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <Container><Docs /></Container>
    </>
  );
}
