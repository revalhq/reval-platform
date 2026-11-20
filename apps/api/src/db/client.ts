import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

/**
 * Hosted Postgres (Supabase, Neon) URLs carry `sslmode=require`. Recent `pg` treats that as `verify-full`,
 * which fails against Supabase's own CA ("self-signed certificate in certificate chain").
 * - DATABASE_CA_CERT set (PEM, e.g. Supabase → Database settings → SSL certificate): verify against it.
 * - Otherwise `sslmode=require` keeps its libpq meaning: encrypted, certificate not verified.
 */
export function poolConfig(url: string, caCert = process.env.DATABASE_CA_CERT): pg.PoolConfig {
  const u = new URL(url);
  const sslmode = u.searchParams.get("sslmode");
  if (caCert) {
    // Connection-string SSL params override the `ssl` option in pg, so drop them.
    for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) u.searchParams.delete(k);
    return { connectionString: u.toString(), ssl: { ca: caCert.replace(/\\n/g, "\n"), rejectUnauthorized: true } };
  }
  if (sslmode === "require" && !u.searchParams.has("uselibpqcompat")) u.searchParams.set("uselibpqcompat", "true");
  return { connectionString: u.toString() };
}

export async function connectPostgres(url: string) {
  const pool = new pg.Pool({ ...poolConfig(url), max: 10 });
  const db = drizzle(pool, { schema });
  return { db: db as unknown as Db, migrate: () => migrate(db, { migrationsFolder: "drizzle" }), close: () => pool.end() };
}
