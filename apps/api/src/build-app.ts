import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { sql } from "drizzle-orm";
import Fastify from "fastify";
import {
  hasZodFastifySchemaValidationErrors, jsonSchemaTransform, serializerCompiler, validatorCompiler,
} from "fastify-type-provider-zod";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { HttpError } from "./lib/http.js";
import { authRoutes } from "./routes/portal/auth.js";
import { orgRoutes } from "./routes/portal/org.js";
import { projectRoutes } from "./routes/portal/projects.js";
import { v1Routes } from "./routes/v1/index.js";
import { webhookRoutes } from "./routes/webhooks.js";

export async function buildApp(db: Db, config: Config) {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: "info", redact: ["req.headers.authorization", "req.headers.cookie"] },
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: true,
  });
  app.decorate("db", db);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // One error shape everywhere: { error: { code, message, details? } }
  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({ error: { code: "validation_error", message: "Request is invalid", details: err.validation } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      const e = err as { code?: string; message?: string };
      return reply.code(status).send({ error: { code: e.code ?? "bad_request", message: e.message ?? "Bad request" } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: "internal_error", message: "Something went wrong" } });
  });

  await app.register(cookie);
  await app.register(swagger, {
    openapi: {
      info: { title: "Reval API", version: "0.1.0", description: "Public API (/v1) for client packages, and the portal API (/portal)." },
      components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "rv_live_..." } } },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/health", { schema: { hide: true } }, async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });

  await app.register(v1Routes(config), { prefix: "/v1" });
  await app.register(authRoutes(config), { prefix: "/portal/auth" });
  await app.register(orgRoutes(config), { prefix: "/portal/orgs" });
  await app.register(projectRoutes, { prefix: "/portal/orgs" });
  await app.register(webhookRoutes(config), { prefix: "/webhooks" });
  return app;
}
