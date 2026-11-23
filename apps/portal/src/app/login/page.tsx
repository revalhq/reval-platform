"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, errorMessage, safeNext } from "@/lib/api";

function LoginForm() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const next = safeNext(params.get("next"));

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      await api("/auth/login", {
        body: { json: { email: form.get("email"), password: form.get("password") } },
      });
      // Full page load, not router.replace: in production the client router has prefetched links
      // (e.g. the logo's "/") while logged out, and cached the proxy's redirect back to /login.
      window.location.replace(next);
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Log in"
      subtitle="Welcome back."
      footer={<>No account yet? <Link href="/register" className="font-medium text-brand-600 hover:text-brand-700">Create one</Link> · <Link href="/docs" className="font-medium text-brand-600 hover:text-brand-700">Read the docs</Link></>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required autoFocus /></Field>
        <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <Button type="submit" loading={loading} className="w-full">Log in</Button>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
