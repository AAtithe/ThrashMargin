import type { Pool } from 'pg';

// Admin access is a role on the user's own row (`users.role`, 'user' | 'admin'), granted and
// removed from the portal's Admin page by an existing admin.
//
// Looked up by userId on every request, not read from the JWT: a token lives for days, and a
// removed admin must lose access on their next request, not when their token expires.
//
// Nothing has to be run by hand. The first time this is called on a database without the column,
// it adds it. The first admin is carried over from the old ADMIN_USERNAMES setting: while no
// account in the database is an admin yet, a sign-in whose username exactly matches that list is
// promoted. Once any admin exists the setting is never read again, and it can be deleted.
//
// Fails closed. Any error means "not an admin".

let schemaReady = false;

async function ensureRoleColumn(db: Pool): Promise<void> {
  if (schemaReady) return;
  // Checked first because ALTER TABLE takes a table lock even when IF NOT EXISTS makes it a no-op.
  const { rowCount } = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role'`,
  );
  if (!rowCount) {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'user'`);
    await db.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
          ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
        END IF;
      END $$;`);
  }
  schemaReady = true;
}

// One-time handover from the old env-var list. Exact, case-sensitive match: usernames are unique
// only case-sensitively, so 'Tom' must not inherit 'tom'.
function wasLegacyAdmin(username: string): boolean {
  return (process.env.ADMIN_USERNAMES ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .includes(username);
}

export async function isAdmin(db: Pool, userId: string): Promise<boolean> {
  try {
    await ensureRoleColumn(db);
    const { rows } = await db.query('SELECT username, role FROM users WHERE id = $1', [userId]);
    const row = rows[0];
    if (!row) return false;
    if (row.role === 'admin') return true;

    if (!wasLegacyAdmin(row.username)) return false;
    // The NOT EXISTS sits inside the UPDATE so the "no admin yet" check and the promotion are one
    // statement: once anyone is an admin, this matches nothing.
    const { rowCount } = await db.query(
      `UPDATE users SET role = 'admin'
       WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')`,
      [userId],
    );
    if (rowCount) console.log(`admin bootstrap: ${userId} promoted from ADMIN_USERNAMES`);
    return !!rowCount;
  } catch (err) {
    console.error('admin role lookup failed', err);
    return false;
  }
}
