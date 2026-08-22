// Deliberately duplicated rather than imported across a package boundary, for the reason
// packages/niccolo/api/_lib/db.ts records: Vercel's per-function file tracing did not include a
// cross-package original in the deployment bundle (confirmed via a diagnostic endpoint — the file
// was simply missing from /var/task at runtime, a FUNCTION_INVOCATION_FAILED with no useful
// error). Keeping each game's API routes self-contained inside its own package avoids depending on
// that tracing behaviour. Same Postgres/Supabase instance for all three games — same env vars,
// same connection, discriminated by the `game` column.
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
