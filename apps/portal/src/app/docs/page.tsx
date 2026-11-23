import type { Metadata } from "next";
import { Docs } from "@/components/docs";
import { Container } from "@/components/shell";
import { SiteHeader } from "@/components/site-header";
import { hasSession } from "@/lib/session";

export const metadata: Metadata = { title: "Documentation" };

/** Public documentation: readable without an account. Signed-in users also get it at /[org]/docs. */
export default async function PublicDocsPage() {
  return (
    <>
      <SiteHeader signedIn={await hasSession()} />
      <Container><Docs /></Container>
    </>
  );
}
