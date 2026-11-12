"use client";

import { createContext, useContext } from "react";
import useSWR from "swr";
import type { Me, OrgSummary, Role } from "./types";

export function useMe() {
  return useSWR<Me>("/auth/me");
}

const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

export interface OrgContextValue {
  me: Me;
  org: OrgSummary;
  /** Portal API path for this org, e.g. orgApi("/runs") → "/orgs/<uuid>/runs" */
  orgApi: (path?: string) => string;
  /** Portal page href for this org, e.g. href("/runs/12") → "/acme/runs/12" */
  href: (path?: string) => string;
  can: (minRole: Role) => boolean;
  subscriptionActive: boolean;
}

export const OrgContext = createContext<OrgContextValue | null>(null);

export function buildOrgContext(me: Me, org: OrgSummary): OrgContextValue {
  return {
    me,
    org,
    orgApi: (path = "") => `/orgs/${org.id}${path}`,
    href: (path = "") => `/${org.slug}${path}`,
    can: (minRole) => RANK[org.role] >= RANK[minRole],
    subscriptionActive: org.subscriptionStatus === "active" || org.subscriptionStatus === "past_due",
  };
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used inside an organization page");
  return ctx;
}

const LAST_ORG_KEY = "reval:lastOrg";
export function rememberOrg(slug: string) {
  try { localStorage.setItem(LAST_ORG_KEY, slug); } catch { /* storage unavailable */ }
}
export function lastOrg(): string | null {
  try { return localStorage.getItem(LAST_ORG_KEY); } catch { return null; }
}
