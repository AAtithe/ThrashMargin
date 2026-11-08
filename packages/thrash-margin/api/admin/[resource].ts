import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { PoolClient } from 'pg';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { isAdmin, lockAdmins, recordAudit } from '../_lib/admin';
import { countsByGame, GAMES_BY_TITLE_SQL, GAME_KEYS } from '../../shared/games';
import { isGameKey, isOptIn, NEW_ACCOUNT_GAMES, newAccountAccess, parseGameList, resolveAccess } from '../_lib/access';

// Combines what were two separate functions (users.ts, feedback.ts) into one, dispatching on
// the [resource] route param — Vercel's Hobby plan caps a deployment at 12 serverless
// functions, and the portal's three games plus this admin surface were pushing past it.
// URLs are unchanged: /api/admin/users and /api/admin/feedback still resolve here, alongside
// /api/admin/reset-password, /api/admin/audit, /api/admin/access, /api/admin/access-all and
// /api/admin/settings.

const ROLES = ['user', 'admin'] as const;

async function listUsers(res: VercelResponse) {
  const db = getDb();
  try {
    const { rows } = await db.query(
      `SELECT
         u.id, u.username, u.email, u.role, u.created_at, u.last_login_at, u.game_access,
         ${GAMES_BY_TITLE_SQL} AS by_game,
         COUNT(g.id) FILTER (WHERE g.status = 'active')                 AS active_games,
         COUNT(g.id) FILTER (WHERE g.status = 'victory')                AS wins
       FROM users u
       LEFT JOIN games g ON g.owner_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
    );
    const users = rows.map(r => ({
      id: r.id,
      username: r.username,
      email: r.email,
      role: r.role === 'admin' ? 'admin' : 'user',
      registeredAt: new Date(r.created_at).getTime(),
      lastLoginAt: r.last_login_at ? new Date(r.last_login_at).getTime() : null,
      gamesByTitle: countsByGame(r.by_game),
      games: resolveAccess(r.game_access),
      activeGames: Number(r.active_games),
      wins: Number(r.wins),
    }));
    return res.json({ users });
  } catch (err) {
    console.error('admin list users error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// Runs `work` in one transaction on a dedicated connection, so a change and its audit row are
// written together or not at all. The pool has a single connection (see _lib/db.ts), so nothing
// inside `work` may use getDb() directly.
async function inTransaction<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDb().connect();
  try {
    await client.query('BEGIN');
    const out = await work(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function usernames(c: PoolClient, ids: string[]): Promise<Map<string, { username: string; role: string }>> {
  const { rows } = await c.query('SELECT id, username, role FROM users WHERE id = ANY($1::uuid[])', [ids]);
  return new Map(rows.map(r => [r.id, { username: r.username, role: r.role }]));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH /api/admin/users { id, role } — grant or remove admin.
//
// An admin cannot change their own role. That one rule is what keeps the portal from ever being
// left with no admin: the caller is always an admin and always stays one, so demoting anyone else
// can never remove the last. It also stops an admin locking themselves out by a mis-click.
async function updateUserRole(req: VercelRequest, res: VercelResponse, callerId: string) {
  const { id, role } = req.body ?? {};
  if (typeof id !== 'string' || !UUID_RE.test(id) || !(ROLES as readonly unknown[]).includes(role)) {
    return res.status(400).json({ message: 'id and role (user|admin) required' });
  }
  if (id === callerId) {
    return res.status(400).json({ message: 'You cannot change your own role. Ask another admin.' });
  }
  try {
    const found = await inTransaction(async c => {
      // The caller was an admin when the request began; another admin may have removed them since.
      if (!(await lockAdmins(c, callerId)).stillAdmin) return 'forbidden' as const;
      const names = await usernames(c, [callerId, id]);
      const target = names.get(id);
      if (!target) return false;
      if (target.role === role) return true; // already so; nothing to change or record
      await c.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
      await recordAudit(c, {
        actorId: callerId,
        actorUsername: names.get(callerId)?.username ?? '(unknown)',
        targetId: id,
        targetUsername: target.username,
        action: role === 'admin' ? 'grant_admin' : 'remove_admin',
      });
      return true;
    });
    if (found === 'forbidden') return res.status(403).json({ message: 'Admin access only' });
    if (!found) return res.status(404).json({ message: 'User not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error('admin update role error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

const RECENT_ADMIN_DAYS = 30;

// Unambiguous characters only (no 0/O, 1/l/I), so it can be read out or typed from a message.
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function temporaryPassword(): string {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, b => TEMP_ALPHABET[b % TEMP_ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map(g => g.join('')).join('-');
}

// POST /api/admin/reset-password { id } — sets a new random password and returns it once, for the
// admin to pass on. The player then changes it on their Profile page.
//
// Not for your own account (use Profile, which asks for the current password) and not for another
// admin's: an admin able to reset another admin's password could take over that account, so admin
// accounts change their own passwords only. Nor for an account that stopped being an admin in the
// last RECENT_ADMIN_DAYS: otherwise one admin could demote another, reset their password, sign in
// as them and promote them back, taking the account over in three logged but unprevented steps.
// Clears the account's failed sign-in count, so a player locked out by the attempt limit can sign
// in straight away.
async function resetPassword(req: VercelRequest, res: VercelResponse, callerId: string) {
  const { id } = req.body ?? {};
  if (typeof id !== 'string' || !UUID_RE.test(id)) return res.status(400).json({ message: 'id required' });
  if (id === callerId) {
    return res.status(400).json({ message: 'Change your own password on your Profile page.' });
  }
  const password = temporaryPassword();
  const hash = await bcrypt.hash(password, 12);
  try {
    const outcome = await inTransaction(async c => {
      const names = await usernames(c, [callerId, id]);
      const target = names.get(id);
      if (!target) return 'not_found' as const;
      if (target.role === 'admin') return 'admin' as const;
      const { rowCount: wasAdmin } = await c.query(
        `SELECT 1 FROM admin_audit
         WHERE target_id = $1 AND action = 'remove_admin' AND at > NOW() - make_interval(days => $2)
         LIMIT 1`,
        [id, RECENT_ADMIN_DAYS],
      );
      if (wasAdmin) return 'recent_admin' as const;
      // Also signs the player out everywhere (api/_lib/auth.ts), in case the account was taken over.
      await c.query('UPDATE users SET password = $1, password_changed_at = NOW() WHERE id = $2', [hash, id]);
      await c.query('DELETE FROM login_failures WHERE username_key = LOWER($1)', [target.username]);
      await recordAudit(c, {
        actorId: callerId,
        actorUsername: names.get(callerId)?.username ?? '(unknown)',
        targetId: id,
        targetUsername: target.username,
        action: 'reset_password',
      });
      return 'ok' as const;
    });
    if (outcome === 'not_found') return res.status(404).json({ message: 'User not found' });
    if (outcome === 'admin') {
      return res.status(403).json({ message: "Admins change their own password on their Profile page." });
    }
    if (outcome === 'recent_admin') {
      return res.status(403).json({
        message: `This account was an admin within the last ${RECENT_ADMIN_DAYS} days, so its password cannot be reset here. Its owner can change it on their Profile page.`,
      });
    }
    return res.json({ temporaryPassword: password });
  } catch (err) {
    console.error('admin reset password error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// --- Game access (see _lib/access.ts) ----------------------------------------------------------
//
// Turning a game off does not delete anything: the account's saves for it stay, unreachable, and
// come back as they were if the game is turned on again.

// PATCH /api/admin/access { id, game, enabled } — one game, on or off, for one account.
// One game at a time, not a whole list, so two admins changing different games for the same account
// cannot undo each other: each change reads and writes the account's row under a lock.
async function updateAccess(req: VercelRequest, res: VercelResponse, callerId: string) {
  const { id, game, enabled } = req.body ?? {};
  if (typeof id !== 'string' || !UUID_RE.test(id) || !isGameKey(game) || typeof enabled !== 'boolean') {
    return res.status(400).json({ message: 'id, game and enabled (true|false) required' });
  }
  try {
    const out = await inTransaction(async c => {
      const { rows } = await c.query('SELECT username, game_access FROM users WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0]) return null;
      const current = resolveAccess(rows[0].game_access);
      if (current.includes(game) === enabled) return current; // already so; nothing to change or record
      const next = enabled ? GAME_KEYS.filter(k => k === game || current.includes(k)) : current.filter(k => k !== game);
      await c.query('UPDATE users SET game_access = $1::jsonb WHERE id = $2', [JSON.stringify(next), id]);
      const names = await usernames(c, [callerId]);
      await recordAudit(c, {
        actorId: callerId,
        actorUsername: names.get(callerId)?.username ?? '(unknown)',
        targetId: id,
        targetUsername: rows[0].username,
        action: enabled ? 'grant_game' : 'revoke_game',
        detail: game,
      });
      return next;
    });
    if (!out) return res.status(404).json({ message: 'User not found' });
    return res.json({ games: out });
  } catch (err) {
    console.error('admin update access error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// POST /api/admin/access-all { game, enabled } — one game, on or off, for every existing account.
// New accounts are not affected: they follow the "new accounts" setting below.
async function updateAccessAll(req: VercelRequest, res: VercelResponse, callerId: string) {
  const { game, enabled } = req.body ?? {};
  if (!isGameKey(game) || typeof enabled !== 'boolean') {
    return res.status(400).json({ message: 'game and enabled (true|false) required' });
  }
  try {
    const changed = await inTransaction(async c => {
      // An account at NULL already has every game but the opt-in ones (_lib/access.ts). Turning an
      // ordinary game off gives it every default game but that one; turning an opt-in game on gives it
      // the defaults plus that game. Either way a NULL account is only rewritten when it must change.
      const optIn = isOptIn(game);
      const defaults = resolveAccess(null);
      let rowCount = 0;
      if (enabled) {
        rowCount += (await c.query(
          `UPDATE users SET game_access = game_access || to_jsonb($1::text)
           WHERE game_access IS NOT NULL AND NOT (game_access ? $1)`,
          [game],
        )).rowCount ?? 0;
        if (optIn) {
          rowCount += (await c.query('UPDATE users SET game_access = $1::jsonb WHERE game_access IS NULL', [
            JSON.stringify(GAME_KEYS.filter(k => k === game || defaults.includes(k))),
          ])).rowCount ?? 0;
        }
      } else {
        rowCount += (await c.query(
          `UPDATE users SET game_access = game_access - $1::text WHERE game_access IS NOT NULL AND game_access ? $1`,
          [game],
        )).rowCount ?? 0;
        if (!optIn) {
          rowCount += (await c.query('UPDATE users SET game_access = $1::jsonb WHERE game_access IS NULL', [
            JSON.stringify(defaults.filter(k => k !== game)),
          ])).rowCount ?? 0;
        }
      }
      const names = await usernames(c, [callerId]);
      await recordAudit(c, {
        actorId: callerId,
        actorUsername: names.get(callerId)?.username ?? '(unknown)',
        targetId: null,
        targetUsername: '(all accounts)',
        action: enabled ? 'grant_game' : 'revoke_game',
        detail: game,
      });
      return rowCount ?? 0;
    });
    return res.json({ success: true, changed });
  } catch (err) {
    console.error('admin update access for all error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// GET /api/admin/settings — { newAccountGames, saved }. `saved` is false while the setting has never
// been changed, in which case new accounts get every game but the opt-in ones, including any added
// to the portal later.
async function getSettings(res: VercelResponse) {
  try {
    const games = await newAccountAccess(getDb());
    return res.json({ newAccountGames: games ?? resolveAccess(null), saved: games !== null });
  } catch (err) {
    console.error('admin get settings error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// PUT /api/admin/settings { newAccountGames: [game keys] } — the games a new account starts with.
async function updateSettings(req: VercelRequest, res: VercelResponse, callerId: string) {
  const games = parseGameList((req.body ?? {}).newAccountGames);
  if (!games) return res.status(400).json({ message: 'newAccountGames must be a list of game keys' });
  try {
    await inTransaction(async c => {
      await c.query(
        `INSERT INTO portal_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [NEW_ACCOUNT_GAMES, JSON.stringify(games)],
      );
      const names = await usernames(c, [callerId]);
      await recordAudit(c, {
        actorId: callerId,
        actorUsername: names.get(callerId)?.username ?? '(unknown)',
        targetId: null,
        targetUsername: '(new accounts)',
        action: 'set_new_account_games',
        detail: games.join(','),
      });
    });
    return res.json({ newAccountGames: games, saved: true });
  } catch (err) {
    console.error('admin update settings error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// GET /api/admin/audit — the most recent 100 access changes, newest first.
async function listAudit(res: VercelResponse) {
  try {
    const { rows } = await getDb().query(
      `SELECT id, at, actor_username, target_username, action, detail
       FROM admin_audit ORDER BY at DESC, id DESC LIMIT 100`,
    );
    return res.json({
      entries: rows.map(r => ({
        id: String(r.id),
        at: new Date(r.at).getTime(),
        actor: r.actor_username,
        target: r.target_username,
        action: r.action,
        detail: r.detail,
      })),
    });
  } catch (err) {
    console.error('admin list audit error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function listFeedback(res: VercelResponse) {
  const db = getDb();
  try {
    const { rows } = await db.query(
      `SELECT f.id, f.game, f.type, f.message, f.status, f.created_at,
              u.username
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       ORDER BY f.created_at DESC
       LIMIT 200`,
    );
    const items = rows.map(r => ({
      id: r.id,
      game: r.game,
      type: r.type,
      message: r.message,
      status: r.status,
      createdAt: new Date(r.created_at).getTime(),
      username: r.username ?? '(deleted user)',
    }));
    return res.json({ items });
  } catch (err) {
    console.error('admin list feedback error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

async function updateFeedback(req: VercelRequest, res: VercelResponse) {
  const { id, status } = req.body ?? {};
  if (typeof id !== 'string' || !UUID_RE.test(id) || (status !== 'open' && status !== 'resolved')) {
    return res.status(400).json({ message: 'id and status (open|resolved) required' });
  }
  const db = getDb();
  try {
    await db.query('UPDATE feedback SET status = $1 WHERE id = $2', [status, id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('admin update feedback error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  const user = await requireUser(req, res);
  if (!user) return;
  if (!(await isAdmin(getDb(), user.userId))) return res.status(403).json({ message: 'Admin access only' });

  const resource = req.query.resource;

  if (resource === 'users' && req.method === 'GET') return listUsers(res);
  if (resource === 'users' && req.method === 'PATCH') return updateUserRole(req, res, user.userId);
  if (resource === 'reset-password' && req.method === 'POST') return resetPassword(req, res, user.userId);
  if (resource === 'audit' && req.method === 'GET') return listAudit(res);
  if (resource === 'access' && req.method === 'PATCH') return updateAccess(req, res, user.userId);
  if (resource === 'access-all' && req.method === 'POST') return updateAccessAll(req, res, user.userId);
  if (resource === 'settings' && req.method === 'GET') return getSettings(res);
  if (resource === 'settings' && req.method === 'PUT') return updateSettings(req, res, user.userId);
  if (resource === 'feedback' && req.method === 'GET') return listFeedback(res);
  if (resource === 'feedback' && req.method === 'PATCH') return updateFeedback(req, res);

  return res.status(404).json({ message: 'Not found' });
}
