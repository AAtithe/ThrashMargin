// Deliberately duplicated from packages/thrash-margin/api/_lib/db.ts rather than imported
// across the package boundary: Vercel's per-function file tracing did not include the
// cross-package original in this function's deployment bundle (confirmed via a diagnostic
// endpoint — the file was simply missing from /var/task at runtime, a FUNCTION_INVOCATION_FAILED
// with no useful error). Keeping Niccolo's API routes self-contained within its own package
// avoids depending on that tracing behaviour. Same Postgres/Supabase instance either way — same
// env vars, same connection.
import { Pool } from 'pg';

let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.SUPABASE_DB_URL;

    if (!connectionString) {
      throw new Error('No database connection string found in environment variables');
    }

    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 1,
      idleTimeoutMillis: 10000,
    });
  }
  return pool;
}
