// Applies pending migrations from ./drizzle.
//   Locally:  DATABASE_URL=... npm run db:migrate
//   Vercel:   runs automatically in `vercel-build` for production deploys only.
// Prefers a direct (non-pooled) connection. On Vercel: MIGRATION_DATABASE_URL, POSTGRES_URL_NON_POOLING
// (Supabase integration), DATABASE_URL, POSTGRES_URL. Locally the POSTGRES_* names are ignored so a
// copied Supabase value in .env can't make a local migrate hit the hosted database.
// Needed for serverless deploys, where the server does not migrate on startup.
import { connectPostgres } from "../db/client.js";

const candidates = process.env.VERCEL
  ? ["MIGRATION_DATABASE_URL", "POSTGRES_URL_NON_POOLING", "DATABASE_URL", "POSTGRES_URL"]
  : ["MIGRATION_DATABASE_URL", "DATABASE_URL"];
const source = candidates.find((k) => process.env[k]);
if (!source) {
  console.error("Set MIGRATION_DATABASE_URL or DATABASE_URL (on Vercel: for the environment being deployed).");
  process.exit(1);
}
const url = process.env[source]!;
console.log(`Migrating ${new URL(url).host} (from ${source})`);
const { migrate, close } = await connectPostgres(url);
try {
  await migrate();
  console.log("Migrations applied.");
} finally {
  await close();
}
