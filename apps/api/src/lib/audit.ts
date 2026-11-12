import type { FastifyRequest } from "fastify";
import { auditLog } from "../db/schema.js";

export async function audit(req: FastifyRequest, orgId: string, action: string,
                            target?: string, details: Record<string, unknown> = {}) {
  await req.server.db.insert(auditLog).values({
    orgId, action, target, details,
    actorUserId: req.user?.id ?? null,
    actorApiKeyId: req.apiKey?.keyId ?? null,
  });
}
