import type { IncomingMessage, ServerResponse } from "node:http";
// Vercel's Fastify preset only accepts an entry file that imports "fastify" itself (a static check
// on this file). The app is built in build-app.ts; this import exists solely to satisfy that check.
import "fastify";
import { buildApp } from "./build-app.js";
import { loadConfig } from "./config.js";
import { connectPostgres } from "./db/client.js";

// Entry point for both a long-running server (local, Docker) and Vercel's serverless runtime.
// Keep this the only entry-like file in src/ (no app.ts / index.ts): Vercel picks the entry by file name.
const onVercel = Boolean(process.env.VERCEL);

const config = loadConfig();
const { db, migrate, close } = await connectPostgres(config.DATABASE_URL);
// On Vercel the drizzle/ folder isn't bundled and every cold start would race to migrate,
// so migrations run in the build instead (`vercel-build` → `npm run db:migrate`).
if (!onVercel) await migrate();
const app = await buildApp(db, config);

if (onVercel) {
  await app.ready();
} else {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await app.close();
      await close();
      process.exit(0);
    });
  }
  await app.listen({ host: "0.0.0.0", port: config.PORT });
}

/** Vercel serverless handler: hand the raw Node request to Fastify's router. */
export default function handler(req: IncomingMessage, res: ServerResponse) {
  app.server.emit("request", req, res);
}
