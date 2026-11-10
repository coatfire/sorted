import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Two drivers, one query API:
 *  - DATABASE_URL set   → Neon over HTTP (production, or dev against Neon)
 *  - DATABASE_URL unset → PGlite, an embedded Postgres. Persists to
 *    apps/api/.data in dev, in-memory under test. Migrations are applied on
 *    boot so `pnpm dev` works with nothing installed.
 *
 * PGlite is loaded lazily and marked external in the Lambda bundle, so it
 * never ships to production.
 */
type Db = NeonHttpDatabase<typeof schema>;

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) return drizzle(neon(url), { schema });

  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = new URL("../../", import.meta.url).pathname;
  const dataDir = process.env.VITEST
    ? undefined // in-memory
    : process.env.PGLITE_DIR || `${dir}.data/pglite`;
  if (dataDir) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dataDir, { recursive: true });
  }
  const local = drizzlePglite(new PGlite(dataDir), { schema });
  await migrate(local, { migrationsFolder: `${dir}drizzle` });
  if (!process.env.VITEST) {
    console.log(`[db] DATABASE_URL unset — using embedded Postgres at ${dataDir}`);
  }
  return local as unknown as Db;
}

export const db = await connect();
export { schema };
