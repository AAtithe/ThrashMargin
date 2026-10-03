import type { Pool } from 'pg';

// Admin access is a role on the user's own row (`users.role`, 'user' | 'admin'), granted and
// removed from the portal's Admin page by an existing admin.
//
// Looked up by userId on every request, not read from the JWT: a token lives for up to 12 hours,
// and a removed admin must lose access on their next request, not when their token expires.
//
// Nothing has to be run by hand. The first time this is called on a database without the column,
// it adds it. While no account is an admin yet, the first admin is set automatically when they
// sign in (or load the welcome page), if either:
//   - their username is in the old ADMIN_USERNAMES setting, ignoring capitals, and no other
//     account shares that name ignoring capitals (so 'Tom' and 'tom' can never both qualify), or
//   - theirs is the oldest account on the portal, i.e. the owner who set it up.
// Once any admin exists neither rule is ever used again, and the setting can be deleted.
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

// Old setting, lower-cased for the handover below.
function legacyAdminNames(): string[] {
  return (process.env.ADMIN_USERNAMES ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function isAdmin(db: Pool, userId: string): Promise<boolean> {
  try {
    await ensureRoleColumn(db);
    const { rows } = await db.query('SELECT username, role FROM users WHERE id = $1', [userId]);
    const row = rows[0];
    if (!row) return false;
    if (row.role === 'admin') return true;

    // One statement, so "no admin yet" and the promotion cannot interleave with another sign-in:
    // once anyone is an admin, this matches nothing.
    const { rowCount } = await db.query(
      `UPDATE users u SET role = 'admin'
       WHERE u.id = $1
         AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')
         AND (
           (LOWER(u.username) = ANY($2::text[])
             AND (SELECT COUNT(*) FROM users WHERE LOWER(username) = LOWER(u.username)) = 1)
           OR u.id = (SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1)
         )`,
      [userId, legacyAdminNames()],
    );
    if (rowCount) console.log(`admin bootstrap: ${userId} promoted as first admin`);
    return !!rowCount;
  } catch (err) {
    console.error('admin role lookup failed', err);
    return false;
  }
}
