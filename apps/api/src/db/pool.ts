import type postgres from "postgres";

/**
 * Supabase's pooler on port 6543 (Supavisor, transaction mode) stops answering
 * when postgres-js pipelines several queries on one connection: the queries
 * are sent and the replies never come, so the request hangs until the platform
 * kills it. One query per connection at a time avoids that. `query_timeout` is
 * the backstop for any other silence: fail the request, drop the connection
 * and connect again.
 */
export const POOL = {
  prepare: false,
  max: 2,
  max_pipeline: 1,
  query_timeout: 20,
  connect_timeout: 10,
} satisfies postgres.Options<{}>;
