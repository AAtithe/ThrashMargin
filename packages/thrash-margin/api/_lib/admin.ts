import type { Pool } from 'pg';
import { ensureSchema } from './schema';

// Admin access is a role on the user's own row (`users.role`, 'user' | 'admin'), granted and
// removed from the portal's Admin page by an existing admin.
//
// Looked up by userId on every request, not read from the JWT: a token lives for up to 12 hours,
// and a removed admin must lose access on their next request, not when their token expires.
//
// Nothing has to be run by hand: the role column is added by ensureSchema (./schema.ts).
// While no account is an admin yet, the oldest account on the portal (the owner who set it up)
// becomes admin automatically when it signs in or loads the welcome page. Once any admin exists this
// is never used again.
//
// There used to be a second route: any username listed in the old ADMIN_USERNAMES setting. Removed
// after the November 2026 security review: while the portal had no admin, anyone who registered a
// listed name nobody had taken yet would have been made admin. The setting is no longer read and can
// be deleted from Vercel.
//
// Fails closed. Any error means "not an admin".

export async function isAdmin(db: Pool, userId: string): Promise<boolean> {
  try {
    await ensureSchema(db);
    const { rows } = await db.query('SELECT username, role FROM users WHERE id = $1', [userId]);
    const row = rows[0];
    if (!row) return false;
    if (row.role === 'admin') return true;

    // One statement, so "no admin yet" and the promotion cannot interleave with another sign-in:
    // once anyone is an admin, this matches nothing. Only one row can ever qualify.
    const { rowCount } = await db.query(
      `UPDATE users u SET role = 'admin'
       WHERE u.id = $1
         AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')
         AND u.id = (SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1)`,
      [userId],
    );
    if (rowCount) console.log(`admin bootstrap: ${userId} promoted as first admin`);
    return !!rowCount;
  } catch (err) {
    console.error('admin role lookup failed', err);
    return false;
  }
}

/**
 * Inside a transaction: locks every admin row until it ends and answers whether `userId` is still
 * one of them. Every change that could remove an admin (a demotion, deleting an admin's account)
 * calls this first, so two such changes run one after the other and the second sees the first.
 * Without it, two admins demoting each other at the same moment both passed their checks and left
 * the portal with no admin at all.
 */
export async function lockAdmins(c: { query: Pool['query'] }, userId: string): Promise<{ stillAdmin: boolean; count: number }> {
  const { rows } = await c.query(`SELECT id FROM users WHERE role = 'admin' FOR UPDATE`);
  return { stillAdmin: rows.some(r => r.id === userId), count: rows.length };
}

export interface AuditEntry {
  actorId: string;
  actorUsername: string;
  /** Null for a change to more than one account, or to a portal setting. */
  targetId: string | null;
  /** For those, a description in brackets: '(all accounts)', '(new accounts)'. */
  targetUsername: string;
  action:
    | 'grant_admin'
    | 'remove_admin'
    | 'reset_password'
    | 'grant_game'
    | 'revoke_game'
    | 'set_new_account_games';
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
