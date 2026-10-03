import type { Pool } from 'pg';

/**
 * Additions to the database the API makes for itself, so nothing has to be run by hand in
 * Supabase. Each is idempotent and runs at most once per server instance. The full schema, these
 * included, is in db/schema.sql at the repo root.
 *
 * Every lookup is scoped to our own schema. Supabase has its own auth.users table, which already
 * has a `role` column; an unscoped check once found that column, skipped adding ours, and left
 * every admin lookup failing.
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

async function migrate(db: Pool): Promise<void> {
  // Checked first because ALTER TABLE takes a table lock even when IF NOT EXISTS makes it a no-op.
  const { rows } = await db.query(`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'role')
        AS has_role,
      to_regclass(current_schema() || '.login_failures') IS NOT NULL AS has_login_failures,
      to_regclass(current_schema() || '.admin_audit') IS NOT NULL AS has_admin_audit`);
  const have = rows[0];

  if (!have.has_role) {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'user'`);
    await db.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = 'users_role_check' AND conrelid = 'users'::regclass) THEN
          ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
        END IF;
      END $$;`);
  }

  if (!have.has_login_failures) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS login_failures (
        id            BIGSERIAL PRIMARY KEY,
        username_key  VARCHAR(64) NOT NULL,
        at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_login_failures_key_at ON login_failures (username_key, at)`);
  }

  if (!have.has_admin_audit) {
    await db.query(`
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
    await db.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_at ON admin_audit (at DESC)`);
  }
}
