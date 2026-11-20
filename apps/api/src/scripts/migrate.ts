// Applies pending migrations from ./drizzle.
//   Locally:  DATABASE_URL=... npm run db:migrate
//   Vercel:   runs automatically in `vercel-build` for production deploys only.
// MIGRATION_DATABASE_URL (a direct, non-pooled connection) is preferred when set; falls back to DATABASE_URL.
// Needed for serverless deploys, where the server does not migrate on startup.
import { loadConfig } from "../config.js";
import { connectPostgres } from "../db/client.js";

const url = process.env.MIGRATION_DATABASE_URL || loadConfig({ ...process.env, NODE_ENV: "development" }).DATABASE_URL;
const { migrate, close } = await connectPostgres(url);
try {
  await migrate();
  console.log("Migrations applied.");
} finally {
  await close();
}
