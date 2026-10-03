import type { Pool } from 'pg';
import { ensureSchema } from './schema';

// Admin access is a role on the user's own row (`users.role`, 'user' | 'admin'), granted and
// removed from the portal's Admin page by an existing admin.
//
// Looked up by userId on every request, not read from the JWT: a token lives for up to 12 hours,
// and a removed admin must lose access on their next request, not when their token expires.
//
// Nothing has to be run by hand: the role column is added by ensureSchema (./schema.ts).
// While no account is an admin yet, the first admin is set automatically when they
// sign in (or load the welcome page), if either:
//   - their username is in the old ADMIN_USERNAMES setting, ignoring capitals, and no other
//     account shares that name ignoring capitals (so 'Tom' and 'tom' can never both qualify), or
//   - theirs is the oldest account on the portal, i.e. the owner who set it up.
// Once any admin exists neither rule is ever used again, and the setting can be deleted.
//
// Fails closed. Any error means "not an admin".

// Old setting, lower-cased for the handover below.
function legacyAdminNames(): string[] {
  return (process.env.ADMIN_USERNAMES ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function isAdmin(db: Pool, userId: string): Promise<boolean> {
  try {
    await ensureSchema(db);
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

export interface AuditEntry {
  actorId: string;
  actorUsername: string;
  targetId: string;
  targetUsername: string;
  action: 'grant_admin' | 'remove_admin' | 'reset_password';
  detail?: string;
}

// The permanent record of who changed whose access, shown on the Admin page. Written in the same
// request as the change it records; a change whose audit row cannot be written is not made (the
// callers run both in one transaction).
export async function recordAudit(db: { query: Pool['query'] }, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit (actor_id, actor_username, target_id, target_username, action, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.actorId, e.actorUsername, e.targetId, e.targetUsername, e.action, e.detail ?? null],
  );
}
