import { createRequire as createLocalRequire } from "node:module";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * Two drivers, one query API:
 *  - DATABASE_URL set   → Supabase Postgres via postgres-js
 *  - DATABASE_URL unset → PGlite, an embedded Postgres. Persists to
 *    apps/api/.data in dev, in-memory under test. Migrations are applied on
 *    boot so `pnpm dev` works with nothing installed.
 *
 * Local-only drivers are required at runtime so bundlers cannot hoist their
 * PGlite imports into the production entrypoint.
 */
type Db = PostgresJsDatabase<typeof schema>;

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) return drizzle(postgres(url, { prepare: false, max: 2 }), { schema });

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production");
  }
  const requireLocal = createLocalRequire(import.meta.url);
  const { PGlite }: typeof import("@electric-sql/pglite") = requireLocal("@electric-sql/pglite");
  const { drizzle: drizzlePglite }: typeof import("drizzle-orm/pglite") = requireLocal("drizzle-orm/pglite");
  const { migrate }: typeof import("drizzle-orm/pglite/migrator") = requireLocal("drizzle-orm/pglite/migrator");
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
