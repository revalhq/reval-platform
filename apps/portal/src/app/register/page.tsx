"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useSWRConfig } from "swr";
import { AuthCard } from "@/components/auth-card";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { Me } from "@/lib/types";

export default function RegisterPage() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const organizationName = String(form.get("organizationName") ?? "").trim();
    setLoading(true);
    setError(null);
    try {
      const me = await api<Me>("/auth/register", {
        body: {
          json: {
            name: form.get("name"),
            email: form.get("email"),
            password: form.get("password"),
            ...(organizationName ? { organizationName } : {}),
          },
        },
      });
      await mutate("/auth/me", me, { revalidate: false });
      const org = me.organizations[0];
      router.replace(org ? `/${org.slug}/runs` : "/");
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Start evaluating your AI app in a few minutes."
      footer={<>Already have an account? <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">Log in</Link></>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Your name"><Input name="name" autoComplete="name" required maxLength={100} autoFocus /></Field>
        <Field label="Work email"><Input name="email" type="email" autoComplete="email" required maxLength={254} /></Field>
        <Field label="Password" hint="At least 10 characters.">
          <Input name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={200} />
        </Field>
        <Field label="Organization name" hint="Optional. You can rename it later.">
          <Input name="organizationName" autoComplete="organization" maxLength={100} placeholder="Acme AI" />
        </Field>
        <Button type="submit" loading={loading} className="w-full">Create account</Button>
      </form>
    </AuthCard>
  );
}
