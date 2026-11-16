import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../src/db";

// Supabase's public Data API can read a table in the public schema unless row level security is on.
it("has row level security on every table, so a new one can't be left readable", async () => {
  // The embedded test database answers with `{ rows }`; Postgres answers with the rows themselves.
  const result: unknown = await db.execute(sql`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { name: string }[];
  expect(rows.map((row) => row.name)).toEqual([]);
});
