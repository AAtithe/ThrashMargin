// GENERATED from shared/portal/server/db.ts by scripts/sync-shared.mjs. Do not edit this copy: edit the original,
// then run `npm run sync-shared`. `npm run check` fails while any copy differs.
import { Pool } from 'pg';

// One lazily created pool per server instance. All five games use the same Postgres/Supabase
// database and the same environment variables; rows are told apart by games.game.
let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL;
    if (!connectionString) {
      throw new Error('No database connection string found in environment variables');
    }
    const ssl = tlsOptions();
    pool = new Pool({
      // pg lets ssl settings in the URL override the ssl option below, which would silently drop the
      // certificate check; with a certificate configured, the URL's are removed.
      connectionString: ssl.ca ? withoutUrlTls(connectionString) : connectionString,
      ssl,
      max: 1,
      idleTimeoutMillis: 10000,
    });
  }
  return pool;
}

/**
 * TLS for the database connection. With DATABASE_CA_CERT set (the PEM text of Supabase's
 * certificate, from Project Settings, Database, SSL configuration), the server's certificate is
 * verified against it, so nobody between Vercel and Supabase can pose as the database and collect
 * its password and data. Without it the connection is still encrypted but the certificate is not
 * checked, as it always was: turning verification on with no certificate to check against would
 * refuse the real database and take every game down.
 */
function tlsOptions(): { rejectUnauthorized: boolean; ca?: string } {
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n').trim();
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false };
}

function withoutUrlTls(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    for (const k of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return connectionString;
  }
}
