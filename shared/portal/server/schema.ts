import type { Pool, PoolClient } from 'pg';

/**
 * Additions to the database the API makes for itself, so nothing is ever run by hand in Supabase.
 * Idempotent, and run at most once per server instance. The full schema, these included, is in
 * db/schema.sql at the repo root; keep the two in step.
 *
 * Every lookup is scoped to our own schema: Supabase has its own auth.users table, with a `role`
 * column, and an unscoped check once found that one and skipped adding ours.
 *
 * Runs under an advisory lock, so two server instances starting together cannot race each other's
 * CREATE TABLE (Postgres can fail one of two concurrent CREATE TABLE IF NOT EXISTS).
 */
let ready: Promise<void> | null = null;

export function ensureSchema(db: Pool): Promise<void> {
  if (!ready) {
    ready = migrate(db).catch(err => {
      ready = null; // retried on the next request rather than cached as failed
      throw err;
    });
  }
  return ready;
}

const LOCK_KEY = 74_210_031; // arbitrary, fixed: identifies this migration's advisory lock

async function migrate(db: Pool): Promise<void> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    await apply(c);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

async function hasColumn(c: PoolClient, table: string, column: string): Promise<boolean> {
  const { rowCount } = await c.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return !!rowCount;
}

async function hasTable(c: PoolClient, table: string): Promise<boolean> {
  const { rows } = await c.query(`SELECT to_regclass(current_schema() || '.' || $1) IS NOT NULL AS t`, [table]);
  return rows[0].t;
}

// Each step is checked before it runs because ALTER TABLE takes a table lock even when
// IF NOT EXISTS makes it a no-op.
async function apply(c: PoolClient): Promise<void> {
  if (!(await hasColumn(c, 'users', 'role'))) {
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'user'`);
    await c.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = 'users_role_check' AND conrelid = 'users'::regclass) THEN
          ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
        END IF;
      END $$;`);
  }

  // Sessions issued before this moment are refused (see auth.ts), so changing or resetting a
  // password signs out every other device.
  if (!(await hasColumn(c, 'users', 'password_changed_at'))) {
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ`);
  }

  // Save version, so a stale tab or device cannot overwrite newer progress (see saves.ts).
  if (!(await hasColumn(c, 'games', 'version'))) {
    await c.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0`);
  }

  if (!(await hasTable(c, 'login_failures'))) {
    await c.query(`
      CREATE TABLE IF NOT EXISTS login_failures (
        id            BIGSERIAL PRIMARY KEY,
        username_key  VARCHAR(64) NOT NULL,
        at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_login_failures_key_at ON login_failures (username_key, at)`);
  }

  // Failed sign-ins are also counted per network, not only per username (auth/[mode].ts).
  if (!(await hasColumn(c, 'login_failures', 'address'))) {
    await c.query(`ALTER TABLE login_failures ADD COLUMN IF NOT EXISTS address VARCHAR(64)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_login_failures_address_at ON login_failures (address, at)`);
  }

  if (!(await hasTable(c, 'admin_audit'))) {
    await c.query(`
      CREATE TABLE IF NOT EXISTS admin_audit (
        id               BIGSERIAL PRIMARY KEY,
        at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actor_id         UUID REFERENCES users(id) ON DELETE SET NULL,
        actor_username   VARCHAR(32) NOT NULL,
        target_id        UUID REFERENCES users(id) ON DELETE SET NULL,
        target_username  VARCHAR(32) NOT NULL,
        action           VARCHAR(32) NOT NULL,
        detail           TEXT
      )`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_at ON admin_audit (at DESC)`);
  }

  // Which games an account may play (access.ts in the Thrash Margin API). NULL means every game,
  // so every account that existed before this column keeps everything it had.
  if (!(await hasColumn(c, 'users', 'game_access'))) {
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS game_access JSONB`);
  }

  // Account status (Admin page): 'active', 'pending' (registered while approval was required, not yet
  // approved) or 'suspended'. Only 'active' accounts can sign in or use a session (auth.ts). Every
  // existing account becomes 'active', so nobody is locked out when this is added.
  if (!(await hasColumn(c, 'users', 'status'))) {
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'active'`);
    await c.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = 'users_status_check' AND conrelid = 'users'::regclass) THEN
          ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'pending', 'suspended'));
        END IF;
      END $$;`);
  }

  // News emails (packages/thrash-margin/api/_lib/news.ts). Consent is opt-in and off by default, as
  // UK law requires for marketing email: nobody, existing or new, is emailed until they tick it.
  // The unsubscribe token lets an email's one-click link turn it off without signing in.
  if (!(await hasColumn(c, 'users', 'marketing_opt_in'))) {
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT false`);
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_opt_in_at TIMESTAMPTZ`);
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS unsubscribe_token VARCHAR(64)`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unsubscribe_token ON users (unsubscribe_token)`);
  }

  // The portal's news: what the "What's new" page shows and the emails carry.
  if (!(await hasTable(c, 'announcements'))) {
    await c.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind          VARCHAR(16) NOT NULL,
        title         VARCHAR(120) NOT NULL,
        summary       TEXT NOT NULL,
        game          VARCHAR(16),
        sections      JSONB NOT NULL DEFAULT '[]'::jsonb,
        status        VARCHAR(16) NOT NULL DEFAULT 'draft',
        created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        published_at  TIMESTAMPTZ,
        emailed_at    TIMESTAMPTZ
      )`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements (status, published_at DESC)`);
  }

  // One row per email sent (or failed), so a send that stops part-way resumes without anyone
  // receiving it twice: at most one 'sent' row per announcement and account.
  if (!(await hasTable(c, 'email_sends'))) {
    await c.query(`
      CREATE TABLE IF NOT EXISTS email_sends (
        id               BIGSERIAL PRIMARY KEY,
        announcement_id  UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
        email            VARCHAR(255) NOT NULL,
        status           VARCHAR(16) NOT NULL,
        provider_id      VARCHAR(128),
        error            TEXT,
        at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_email_sends_once ON email_sends (announcement_id, user_id) WHERE status = 'sent'`);
  }

  // Portal-wide settings changed on the Admin page, one row per setting. 'new_account_games': the
  // games a newly registered account starts with; 'require_approval': whether it must be approved first.
  if (!(await hasTable(c, 'portal_settings'))) {
    await c.query(`
      CREATE TABLE IF NOT EXISTS portal_settings (
        key         VARCHAR(64) PRIMARY KEY,
        value       JSONB NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
  }

  // Registration and feedback limits (see rateLimit.ts).
  if (!(await hasTable(c, 'rate_events'))) {
    await c.query(`
      CREATE TABLE IF NOT EXISTS rate_events (
        id      BIGSERIAL PRIMARY KEY,
        bucket  VARCHAR(32) NOT NULL,
        key     VARCHAR(128) NOT NULL,
        at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_rate_events ON rate_events (bucket, key, at)`);
  }

  // Two tables from the original single-game server that nothing reads. Dropped only while they
  // hold nothing of value: player_stats rows were only ever created with every counter at its
  // default, and game_actions was never written by this API. Anything else is left alone.
  if (await hasTable(c, 'player_stats')) {
    const { rowCount } = await c.query(
      `SELECT 1 FROM player_stats
       WHERE games_played <> 0 OR games_won <> 0 OR games_lost <> 0 OR avg_turns IS NOT NULL LIMIT 1`,
    );
    if (!rowCount) await c.query('DROP TABLE player_stats');
  }
  if (await hasTable(c, 'game_actions')) {
    const { rowCount } = await c.query('SELECT 1 FROM game_actions LIMIT 1');
    if (!rowCount) await c.query('DROP TABLE game_actions');
  }

  await secureTables(c);
}

/**
 * Every table this API owns, closed to Supabase's Data API (PostgREST). Supabase publishes the
 * public schema to anyone with the project URL and anon key, and grants `anon` and `authenticated`
 * full rights on new tables by default; with row-level security off, that meant anyone could read
 * and rewrite users (emails, password hashes) and every save. Nothing here uses that route: this API
 * connects as the tables' owner, and an owner is exempt from row-level security unless it is FORCEd,
 * which it deliberately is not. So enabling it with no policies, and revoking those grants, shuts
 * the Data API out entirely without changing anything the API itself does.
 *
 * Run inside a savepoint: if the connecting role cannot alter a table (it is not the owner), the
 * failure is logged loudly and the rest of the setup still commits, rather than every request in
 * every game failing. db/schema.sql applies the same statements; keep the two in step.
 */
export const SECURED_TABLES = ['users', 'games', 'feedback', 'login_failures', 'admin_audit', 'rate_events', 'portal_settings', 'announcements', 'email_sends'];
const DATA_API_ROLES = ['anon', 'authenticated'];

async function secureTables(c: PoolClient): Promise<void> {
  await c.query('SAVEPOINT secure_tables');
  try {
    const { rows: tables } = await c.query(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname = ANY($1)`,
      [SECURED_TABLES],
    );
    for (const t of tables) {
      if (!t.relrowsecurity) await c.query(`ALTER TABLE ${c.escapeIdentifier(t.relname)} ENABLE ROW LEVEL SECURITY`);
    }

    // Revoked only where a grant exists, so a database already locked down costs a read, not a
    // catalogue write, on every cold start.
    const { rows: grantees } = await c.query(
      `SELECT DISTINCT r.rolname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL aclexplode(c.relacl) a
       JOIN pg_roles r ON r.oid = a.grantee
       WHERE n.nspname = current_schema() AND r.rolname = ANY($2)
         AND ((c.relkind = 'r' AND c.relname = ANY($1)) OR c.relkind = 'S')`,
      [SECURED_TABLES, DATA_API_ROLES],
    );
    const { rows: [{ schema }] } = await c.query('SELECT current_schema() AS schema');
    const list = tables.map(t => c.escapeIdentifier(t.relname)).join(', ');
    for (const { rolname } of grantees) {
      const role = c.escapeIdentifier(rolname);
      if (list) await c.query(`REVOKE ALL ON ${list} FROM ${role}`);
      await c.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${c.escapeIdentifier(schema)} FROM ${role}`);
    }
    await c.query('RELEASE SAVEPOINT secure_tables');
  } catch (err) {
    await c.query('ROLLBACK TO SAVEPOINT secure_tables');
    console.error('SECURITY: could not enable row-level security on the portal tables', err);
  }
}
