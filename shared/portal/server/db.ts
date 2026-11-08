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
      // Fail fast rather than hang. Without these a stuck connection held the request until Vercel
      // killed the function, which answers in plain text; the browser could not read that and told
      // the player "Network error". Now the endpoint's own catch answers 500/503 as JSON in time.
      connectionTimeoutMillis: 5000,
      query_timeout: 8000,
      statement_timeout: 8000,
    });
    // Supabase's pooler closes idle connections from its side. pg reports that as an 'error' event on
    // the pool; with no listener Node treats it as uncaught and the whole function instance crashes,
    // failing whichever request it is serving with a plain-text 500. The broken client has already
    // been removed from the pool, so logging is all that is needed: the next query opens a fresh one.
    pool.on('error', err => console.error('database: idle connection dropped', err.message));
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
