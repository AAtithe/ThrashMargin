/**
 * The portal's server code, tested end to end against a real Postgres shaped like production.
 *
 *   API_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres npm run test:api
 *
 * "Shaped like production" is the point. The database gets Supabase's own auth.users table (which
 * has a `role` column) alongside ours: an admin bug once passed every local test and failed live
 * purely because that table exists. Two passes:
 *   1. a fresh database built from db/schema.sql, the file a rebuild would use;
 *   2. the live database as it was before this week: no role column, no login_failures, no
 *      admin_audit, so the API's own automatic setup (api/_lib/schema.ts) is what gets tested.
 *
 * It drops and recreates the whole public schema, so it refuses to run against anything but a
 * local database.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';

const URL_ = process.env.API_TEST_DATABASE_URL ?? '';
const host = (() => {
  try {
    return new URL(URL_).hostname;
  } catch {
    return '';
  }
})();
if (!['localhost', '127.0.0.1'].includes(host)) {
  console.error('Refusing to run: API_TEST_DATABASE_URL must point at a local database (it is wiped).');
  process.exit(2);
}
process.env.DATABASE_URL = URL_;
process.env.JWT_SECRET = 'api-test-secret';

const ROOT = path.resolve(__dirname, '..');
const admin = new Pool({ connectionString: URL_, ssl: { rejectUnauthorized: false } });

type Handler = (req: any, res: any) => unknown;
let handlers: Record<string, Handler>;

let failures = 0;
let passes = 0;
function ok(cond: unknown, label: string) {
  if (cond) passes++;
  else {
    failures++;
    console.log(`  FAIL ${label}`);
  }
}

interface Out {
  status: number;
  body: any;
  headers: Record<string, string>;
}
async function call(
  h: Handler,
  method: string,
  query: Record<string, string>,
  body?: unknown,
  token?: string,
  extraHeaders: Record<string, string> = {},
): Promise<Out> {
  const out: Out = { status: 200, body: undefined, headers: {} };
  const res: any = {
    setHeader(k: string, v: string) {
      out.headers[k.toLowerCase()] = v;
    },
    status(s: number) {
      out.status = s;
      return res;
    },
    json(b: unknown) {
      out.body = b;
      return res;
    },
    end() {
      return res;
    },
  };
  const headers: Record<string, string> = { ...extraHeaders, ...(token ? { authorization: `Bearer ${token}` } : {}) };
  await h({ method, query, body, headers }, res);
  return out;
}

const auth = (mode: string, body: unknown, ip = '10.0.0.1') =>
  call(handlers.auth, 'POST', { mode }, body, undefined, { 'x-forwarded-for': ip });
const adminApi = (method: string, resource: string, token: string, body?: unknown) =>
  call(handlers.admin, method, { resource }, body, token);
const play = (method: string, kind: string, token: string | undefined, id?: string, body?: unknown) =>
  call(handlers.play, method, id ? { kind, id } : { kind }, body, token);

async function resetDatabase(mode: 'fresh' | 'legacy') {
  await admin.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  // Supabase's own table, as it exists in production: a `users` table with a `role` column, and a
  // `users_role_check`-style name collision risk, in a schema of its own.
  await admin.query(`
    DROP SCHEMA IF EXISTS auth CASCADE;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, role varchar(255), email varchar(255));
    INSERT INTO auth.users VALUES (gen_random_uuid(), 'authenticated', 'someone@example.com');`);
  await admin.query(readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8'));
  if (mode === 'legacy') {
    // As the live database was before these rounds: none of the later columns or tables, and the
    // original server's two unused tables still present (player_stats with default-only rows).
    await admin.query(`
      ALTER TABLE users DROP COLUMN role;
      ALTER TABLE users DROP COLUMN password_changed_at;
      ALTER TABLE games DROP COLUMN version;
      DROP TABLE login_failures;
      DROP TABLE admin_audit;
      DROP TABLE rate_events;
      CREATE TABLE player_stats (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        games_played INTEGER NOT NULL DEFAULT 0, games_won INTEGER NOT NULL DEFAULT 0,
        games_lost INTEGER NOT NULL DEFAULT 0, avg_turns NUMERIC(6,2));
      CREATE TABLE game_actions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id),
        turn INTEGER NOT NULL, action JSONB NOT NULL);`);
  }
}

async function suite(mode: 'fresh' | 'legacy') {
  console.log(`\n== ${mode === 'fresh' ? 'Database built from db/schema.sql' : 'Pre-existing database, automatic setup'}`);
  await resetDatabase(mode);
  // The API caches "schema ready" per process; a new import per pass is the honest equivalent of
  // a fresh server instance.
  for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}api${path.sep}`)) delete require.cache[k];
  handlers = {
    auth: require(path.join(ROOT, 'api/auth/[mode]')).default,
    admin: require(path.join(ROOT, 'api/admin/[resource]')).default,
    profile: require(path.join(ROOT, 'api/profile')).default,
    feedback: require(path.join(ROOT, 'api/feedback')).default,
    play: require(path.join(ROOT, 'api/play/[kind]')).default,
    health: require(path.join(ROOT, 'api/health')).default,
  };
  const { GAMES } = require(path.join(ROOT, 'packages/thrash-margin/shared/games'));

  process.env.ADMIN_USERNAMES = 'tom';

  // --- Registration -------------------------------------------------------------------------
  const tom = await auth('register', { username: 'Tom', email: 'tom@x.test', password: 'secret1' });
  ok(tom.status === 201 && tom.body.isAdmin === false, 'register: Tom created, not yet admin');
  const ann = await auth('register', { username: 'ann', email: 'ann@x.test', password: 'secret1' });
  ok(ann.status === 201, 'register: ann created');
  ok((await auth('register', { username: 'tom', email: 't2@x.test', password: 'secret1' })).status === 409, 'register: case-variant of Tom refused');
  ok((await auth('register', { username: 'bob', email: 'b@x.test', password: '123' })).status === 400, 'register: short password refused');
  ok((await auth('register', { username: 'bob', email: 'b@x.test', password: 12345678 })).status === 400, 'register: non-string password refused');
  ok((await auth('register', { username: 'bob', email: 'not-an-email', password: 'secret1' })).status === 400, 'register: invalid email refused');
  if (mode === 'legacy') {
    const left = await admin.query(`SELECT to_regclass('public.player_stats') AS p, to_regclass('public.game_actions') AS g`);
    ok(!left.rows[0].p && !left.rows[0].g, 'schema: unused player_stats and game_actions dropped while empty');
  }
  for (let i = 0; i < 5; i++) {
    await auth('register', { username: `spam${i}`, email: `spam${i}@x.test`, password: 'secret1' }, '10.9.9.9');
  }
  const sixth = await auth('register', { username: 'spam5', email: 'spam5@x.test', password: 'secret1' }, '10.9.9.9');
  ok(sixth.status === 429, 'limit: 6th account from one network address in an hour refused');
  ok((await auth('register', { username: 'carol', email: 'c@x.test', password: 'secret1' }, '10.7.7.7')).status === 201, 'limit: other addresses unaffected');
  ok(!('access-control-allow-origin' in tom.headers), 'cors: no cross-site permission sent by default');
  const health = await call(handlers.health, 'GET', {});
  ok(health.status === 200 && health.body.database === 'ok', 'health: reports the database reachable');

  // --- Sign-in and first admin ----------------------------------------------------------------
  const tomLogin = await auth('login', { username: 'Tom', password: 'secret1' });
  ok(tomLogin.status === 200 && tomLogin.body.isAdmin === true, 'login: Tom becomes first admin (setting "tom", account "Tom")');
  const T = tomLogin.body.token as string;
  const annLogin = await auth('login', { username: 'ann', password: 'secret1' });
  ok(annLogin.body.isAdmin === false, 'login: ann is not admin');
  const A = annLogin.body.token as string;
  const claims = jwt.decode(T) as { iat: number; exp: number };
  ok(claims.exp - claims.iat === 12 * 3600, 'login: token lasts 12 hours');
  const stale = jwt.sign({ userId: tom.body.userId, username: 'Tom', iat: Math.floor(Date.now() / 1000) - 13 * 3600 }, 'api-test-secret', { expiresIn: '7d' });
  ok((await call(handlers.profile, 'GET', {}, undefined, stale)).status === 401, 'session: 13-hour-old token refused');
  ok((await play('GET', 'tea-race', stale)).status === 401, 'session: 13-hour-old token refused for saves');
  const cols = await admin.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role'`,
  );
  ok(cols.rowCount === 1, 'schema: role column present on public.users');

  // --- Sign-in attempt limit ------------------------------------------------------------------
  for (let i = 0; i < 10; i++) await auth('login', { username: 'ann', password: 'wrong' });
  const locked = await auth('login', { username: 'ann', password: 'secret1' });
  ok(locked.status === 429, 'limit: 11th attempt refused even with the right password');
  ok((await auth('login', { username: 'ANN', password: 'secret1' })).status === 429, 'limit: applies whatever the capitals');
  ok((await auth('login', { username: 'Tom', password: 'secret1' })).status === 200, 'limit: other accounts unaffected');
  for (let i = 0; i < 10; i++) await auth('login', { username: 'nobody', password: 'x' });
  ok((await auth('login', { username: 'nobody', password: 'x' })).status === 429, 'limit: unknown usernames limited the same way');

  // --- Admin: roles, password reset, audit -------------------------------------------------------
  ok((await adminApi('GET', 'users', A)).status === 403, 'admin: non-admin refused');
  ok((await adminApi('PATCH', 'users', T, { id: tom.body.userId, role: 'user' })).status === 400, 'admin: cannot change own role');
  ok((await adminApi('PATCH', 'users', T, { id: 'not-a-uuid', role: 'admin' })).status === 400, 'admin: malformed id refused');
  ok((await adminApi('POST', 'reset-password', T, { id: tom.body.userId })).status === 400, 'reset: not for your own account');

  const reset = await adminApi('POST', 'reset-password', T, { id: ann.body.userId });
  ok(reset.status === 200 && /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(reset.body.temporaryPassword), 'reset: returns a temporary password');
  ok((await auth('login', { username: 'ann', password: 'secret1' })).status === 401, 'reset: old password stops working (and lock cleared)');
  const annAgain = await auth('login', { username: 'ann', password: reset.body.temporaryPassword });
  ok(annAgain.status === 200, 'reset: temporary password signs in');

  ok((await adminApi('PATCH', 'users', T, { id: ann.body.userId, role: 'admin' })).status === 200, 'role: Tom makes ann admin');
  ok((await adminApi('GET', 'users', annAgain.body.token)).status === 200, 'role: ann has access at once, same token');
  ok((await adminApi('POST', 'reset-password', T, { id: ann.body.userId })).status === 403, 'reset: not for another admin');
  ok((await adminApi('PATCH', 'users', T, { id: ann.body.userId, role: 'user' })).status === 200, 'role: Tom removes ann');
  ok((await adminApi('GET', 'users', annAgain.body.token)).status === 403, 'role: ann loses access at once, same token');

  const audit = await adminApi('GET', 'audit', T);
  const actions = (audit.body.entries as { action: string; actor: string; target: string }[]).map(e => `${e.actor} ${e.action} ${e.target}`);
  ok(
    JSON.stringify(actions) === JSON.stringify(['Tom remove_admin ann', 'Tom grant_admin ann', 'Tom reset_password ann']),
    `audit: three changes recorded newest first (got ${JSON.stringify(actions)})`,
  );

  // --- Every game's saves, through the one /api/play function -------------------------------------
  const A2 = annAgain.body.token as string;
  for (const g of GAMES as { key: string; slug: string; label: string }[]) {
    ok((await play('GET', g.slug, undefined)).status === 401, `${g.slug}: no token, 401`);
    const created = await play('POST', g.slug, A2, undefined, { name: `${g.label} test` });
    ok(created.status === 201 && typeof created.body.gameId === 'string', `${g.slug}: create`);
    const id = created.body.gameId as string;
    const list = await play('GET', g.slug, A2);
    ok(list.status === 200 && list.body.saves.some((s: { id: string }) => s.id === id), `${g.slug}: listed`);
    const loaded = await play('GET', g.slug, A2, id);
    ok(loaded.status === 200 && loaded.body.state, `${g.slug}: load`);
    ok(created.body.version === 0 && loaded.body.version === 0, `${g.slug}: new game at version 0`);
    const s1 = await play('PUT', g.slug, A2, id, { state: loaded.body.state, version: 0 });
    ok(s1.status === 200 && s1.body.version === 1, `${g.slug}: save bumps version to 1`);
    const stale = await play('PUT', g.slug, A2, id, { state: loaded.body.state, version: 0 });
    ok(stale.status === 409, `${g.slug}: save from a stale tab refused (409)`);
    ok((await play('PUT', g.slug, A2, id, { state: loaded.body.state })).status === 200, `${g.slug}: save without a version still accepted`);
    ok((await play('PUT', g.slug, A2, '00000000-0000-4000-8000-000000000000', { state: loaded.body.state, version: 0 })).status === 404, `${g.slug}: save to a missing game is 404, not success`);
    ok((await play('GET', g.slug, A2, 'not-a-uuid')).status === 404, `${g.slug}: malformed id is 404, not a server error`);
    ok((await play('GET', g.slug, T, id)).status === 404, `${g.slug}: another player cannot load it`);
    const others = (GAMES as { slug: string }[]).filter(o => o.slug !== g.slug);
    ok((await play('GET', others[0].slug, A2, id)).status === 404, `${g.slug}: not visible through another game's endpoint`);
  }
  ok((await play('GET', 'no-such-game', A2)).status === 404, 'play: unknown game 404');

  // --- Shared game list ---------------------------------------------------------------------------
  const profile = await call(handlers.profile, 'GET', {}, undefined, A2);
  const counts = profile.body.gamesByTitle as Record<string, number>;
  ok(
    (GAMES as { key: string }[]).every(g => counts[g.key] === 1),
    `profile: one save counted in every game (got ${JSON.stringify(counts)})`,
  );
  for (const g of GAMES as { key: string; slug: string }[]) {
    await call(handlers.feedback, 'POST', {}, { game: g.key, type: 'bug', message: `about ${g.slug}` }, A2);
  }
  const fb = await adminApi('GET', 'feedback', T);
  const filed = new Set((fb.body.items as { game: string }[]).map(i => i.game));
  ok(
    (GAMES as { key: string }[]).every(g => filed.has(g.key)) && !filed.has('general'),
    `feedback: filed under each game, none dropped to general (got ${JSON.stringify([...filed])})`,
  );
  for (let i = 0; i < 5; i++) await call(handlers.feedback, 'POST', {}, { game: 'general', message: `more ${i}` }, A2);
  const tooMuch = await call(handlers.feedback, 'POST', {}, { game: 'general', message: 'eleventh' }, A2);
  ok(tooMuch.status === 429, 'limit: 11th feedback in an hour refused');
  const users = await adminApi('GET', 'users', T);
  ok(
    (users.body.users as { username: string; gamesByTitle: Record<string, number> }[]).find(u => u.username === 'ann')
      ?.gamesByTitle.niccolo_rising === 1,
    'admin: per-game counts include Niccolò Rising',
  );

  // Delete last, so the cascade does not matter to the checks above.
  for (const g of GAMES as { slug: string }[]) {
    const list = await play('GET', g.slug, A2);
    for (const s of list.body.saves as { id: string }[]) await play('DELETE', g.slug, A2, s.id);
    ok((await play('GET', g.slug, A2)).body.saves.length === 0, `${g.slug}: delete`);
  }
  // --- Password change signs out other sessions -------------------------------------------------
  const carolLogin = await auth('login', { username: 'carol', password: 'secret1' });
  const C1 = carolLogin.body.token as string;
  await new Promise(r => setTimeout(r, 1100)); // tokens carry whole seconds; make the change strictly later
  const changed = await call(handlers.profile, 'PATCH', {}, { currentPassword: 'secret1', newPassword: 'secret2' }, C1);
  ok(changed.status === 200 && typeof changed.body.token === 'string', 'password change: returns a fresh token');
  ok((await call(handlers.profile, 'GET', {}, undefined, C1)).status === 401, 'password change: older session signed out');
  ok((await call(handlers.profile, 'GET', {}, undefined, changed.body.token)).status === 200, 'password change: fresh token works');
  ok((await call(handlers.profile, 'PATCH', {}, { currentPassword: 'secret2', newEmail: 'nope' }, changed.body.token)).status === 400, 'profile: invalid email refused');
  await new Promise(r => setTimeout(r, 1100));
  const reset2 = await adminApi('POST', 'reset-password', T, { id: carolLogin.body.userId });
  ok(reset2.status === 200, 'reset: carol reset by admin');
  ok((await call(handlers.profile, 'GET', {}, undefined, changed.body.token)).status === 401, 'reset: signs the player out everywhere');

  // --- Account deletion -------------------------------------------------------------------------------
  const tomSelf = await call(handlers.profile, 'DELETE', {}, { password: 'secret1' }, T);
  ok(tomSelf.status === 409, 'delete: the only admin cannot delete their account');
  const annDel = await auth('login', { username: 'ann', password: reset.body.temporaryPassword });
  const AD = annDel.body.token as string;
  await play('POST', 'tea-race', AD, undefined, { name: 'doomed' });
  ok((await call(handlers.profile, 'DELETE', {}, { password: 'wrong' }, AD)).status === 403, 'delete: wrong password refused');
  const gone = await call(handlers.profile, 'DELETE', {}, { password: reset.body.temporaryPassword }, AD);
  ok(gone.status === 200, 'delete: account deleted');
  ok((await call(handlers.profile, 'GET', {}, undefined, AD)).status === 401, 'delete: its session stops working at once');
  const leftovers = await admin.query(`SELECT COUNT(*)::int AS n FROM games g JOIN users u ON u.id = g.owner_id WHERE u.username = 'ann'`);
  const orphans = await admin.query(`SELECT COUNT(*)::int AS n FROM games WHERE owner_id NOT IN (SELECT id FROM users)`);
  ok(leftovers.rows[0].n === 0 && orphans.rows[0].n === 0, 'delete: every saved game removed');
  const fbKept = await admin.query(`SELECT COUNT(*)::int AS n FROM feedback WHERE user_id IS NULL`);
  ok(fbKept.rows[0].n > 0, 'delete: feedback kept without the name');
  ok((await auth('login', { username: 'ann', password: reset.body.temporaryPassword })).status === 401, 'delete: cannot sign in again');

  delete process.env.ADMIN_USERNAMES;
}

(async () => {
  try {
    await suite('fresh');
    await suite('legacy');
  } finally {
    await admin.query('DROP SCHEMA IF EXISTS auth CASCADE').catch(() => {});
    await admin.end();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
