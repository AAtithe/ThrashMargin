import type { Pool } from 'pg';

// Admin access is a role on the user's own row (`users.role`, 'user' | 'admin'), granted and
// removed from the portal's Admin page by an existing admin. The first admin is set once by the
// migration in db/migrations/2026-10-03_user_roles.sql.
//
// Looked up by userId on every request, not read from the JWT: a token lives for days, and a
// removed admin must lose access on their next request, not when their token expires. The userId
// is the signed, immutable key; usernames are not used here at all.
//
// Fails closed. Any error, including the role column not existing yet because the migration has
// not been run, means "not an admin".
export async function isAdmin(db: Pool, userId: string): Promise<boolean> {
  try {
    const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    return rows[0]?.role === 'admin';
  } catch (err) {
    console.error('admin role lookup failed', err);
    return false;
  }
}
