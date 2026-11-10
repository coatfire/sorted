import { defineConfig } from "drizzle-kit";

// `generate` only needs the schema; `migrate`/`studio` need DATABASE_URL.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
