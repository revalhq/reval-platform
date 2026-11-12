"use client";

import useSWR from "swr";
import { Alert, Badge, Card, Loading, Table, Td, Th } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { date } from "@/lib/format";
import { useOrg } from "@/lib/hooks";
import type { OrgDetail, Role } from "@/lib/types";

const ROLE_TONE: Record<Role, "brand" | "blue" | "zinc"> = { owner: "brand", admin: "blue", member: "zinc" };

export default function MembersPage() {
  const { orgApi, me } = useOrg();
  const { data, error } = useSWR<OrgDetail>(orgApi());
  if (error) return <Alert>{errorMessage(error)}</Alert>;
  if (!data) return <Loading />;

  return (
    <div className="space-y-4">
      <Card padded={false} title={`${data.members.length} member${data.members.length === 1 ? "" : "s"}`}>
        <Table>
          <thead className="bg-zinc-50"><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Joined</Th></tr></thead>
          <tbody className="divide-y divide-zinc-100">
            {data.members.map((m) => (
              <tr key={m.userId}>
                <Td className="font-medium text-zinc-900">{m.name}{m.userId === me.user.id && <span className="ml-1.5 text-xs font-normal text-zinc-500">(you)</span>}</Td>
                <Td className="text-zinc-600">{m.email}</Td>
                <Td><Badge tone={ROLE_TONE[m.role]} className="capitalize">{m.role}</Badge></Td>
                <Td className="text-zinc-600">{date(m.joinedAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Alert tone="info">
        Inviting members is coming soon. Owners manage billing; admins manage projects, datasets and API keys; members can view everything and cancel runs.
      </Alert>
    </div>
  );
}
