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
// The API connects as an ordinary owner role, as on Supabase (its `postgres` is not a superuser).
// A superuser ignores row-level security altogether, so testing as one would prove nothing about it.
const API_ROLE = 'portal_api_test';
process.env.DATABASE_URL = (() => {
  const u = new URL(URL_);
  u.username = API_ROLE;
  u.password = API_ROLE;
  return u.toString();
})();
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
  // Supabase's Data API roles, and the API's own non-superuser owner role.
  await admin.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${API_ROLE}') THEN
        CREATE ROLE ${API_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${API_ROLE}';
      END IF;
    END $$;
    GRANT ALL ON SCHEMA public TO ${API_ROLE};
    GRANT USAGE ON SCHEMA public TO anon, authenticated;`);
  // Supabase's own table, as it exists in production: a `users` table with a `role` column, and a
  // `users_role_check`-style name collision risk, in a schema of its own.
  await admin.query(`
    DROP SCHEMA IF EXISTS auth CASCADE;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, role varchar(255), email varchar(255));
    INSERT INTO auth.users VALUES (gen_random_uuid(), 'authenticated', 'someone@example.com');`);
  // Built as the API's role, so it owns the tables exactly as the live database's owner does.
  await admin.query(`SET ROLE ${API_ROLE}; ${readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8')}; RESET ROLE;`);
  if (mode === 'legacy') {
    // As the live database was before these rounds: none of the later columns or tables, and the
    // original server's two unused tables still present (player_stats with default-only rows).
    await admin.query(`
      SET ROLE ${API_ROLE};
      ALTER TABLE users DROP COLUMN role;
      ALTER TABLE users DROP COLUMN password_changed_at;
      ALTER TABLE users DROP COLUMN game_access;
      ALTER TABLE games DROP COLUMN version;
      DROP TABLE login_failures;
      DROP TABLE admin_audit;
      DROP TABLE rate_events;
      DROP TABLE portal_settings;
      CREATE TABLE player_stats (user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        games_played INTEGER NOT NULL DEFAULT 0, games_won INTEGER NOT NULL DEFAULT 0,
        games_lost INTEGER NOT NULL DEFAULT 0, avg_turns NUMERIC(6,2));
      CREATE TABLE game_actions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id),
        turn INTEGER NOT NULL, action JSONB NOT NULL);
      RESET ROLE;`);
    // As the live database was when Supabase flagged it: row-level security off, and the Data API
    // roles holding Supabase's default grants on every table and sequence.
    await admin.query(`
      SET ROLE ${API_ROLE};
      ALTER TABLE users DISABLE ROW LEVEL SECURITY;
      ALTER TABLE games DISABLE ROW LEVEL SECURITY;
      ALTER TABLE feedback DISABLE ROW LEVEL SECURITY;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
      RESET ROLE;`);
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

  // --- Registration -------------------------------------------------------------------------
  const tom = await auth('register', { username: 'Tom', email: 'tom@x.test', password: 'secret11' });
  ok(tom.status === 201 && tom.body.isAdmin === false, 'register: Tom created, not yet admin');
  const ann = await auth('register', { username: 'ann', email: 'ann@x.test', password: 'secret11' });
  ok(ann.status === 201, 'register: ann created');
  ok((await auth('register', { username: 'tom', email: 't2@x.test', password: 'secret11' })).status === 409, 'register: case-variant of Tom refused');
  ok((await auth('register', { username: 'bob', email: 'b@x.test', password: '123' })).status === 400, 'register: short password refused');
  ok((await auth('register', { username: 'bob', email: 'b@x.test', password: 'seven77' })).status === 400, 'register: 7-character password refused (minimum is 8)');
  ok((await auth('register', { username: 'bob', email: 'b@x.test', password: 12345678 })).status === 400, 'register: non-string password refused');
  ok((await auth('register', { username: 'bob', email: 'not-an-email', password: 'secret11' })).status === 400, 'register: invalid email refused');
  if (mode === 'legacy') {
    const left = await admin.query(`SELECT to_regclass('public.player_stats') AS p, to_regclass('public.game_actions') AS g`);
    ok(!left.rows[0].p && !left.rows[0].g, 'schema: unused player_stats and game_actions dropped while empty');
  }
  for (let i = 0; i < 5; i++) {
    await auth('register', { username: `spam${i}`, email: `spam${i}@x.test`, password: 'secret11' }, '10.9.9.9');
  }
  const sixth = await auth('register', { username: 'spam5', email: 'spam5@x.test', password: 'secret11' }, '10.9.9.9');
  ok(sixth.status === 429, 'limit: 6th account from one network address in an hour refused');
  ok((await auth('register', { username: 'carol', email: 'c@x.test', password: 'secret11' }, '10.7.7.7')).status === 201, 'limit: other addresses unaffected');
  ok(!('access-control-allow-origin' in tom.headers), 'cors: no cross-site permission sent by default');
  const health = await call(handlers.health, 'GET', {});
  ok(health.status === 200 && health.body.database === 'ok', 'health: reports the database reachable');

  // Supabase's pooler drops idle connections. With no 'error' listener on the pool, pg's report of
  // that crashed the whole function instance, and the player saw "Network error" on starting a game.
  {
    const { getDb } = require(path.join(ROOT, 'packages/thrash-margin/api/_lib/db'));
    const db = getDb();
    const { rows: [{ pid }] } = await db.query('SELECT pg_backend_pid() AS pid');
    await admin.query('SELECT pg_terminate_backend($1)', [pid]);
    await new Promise(r => setTimeout(r, 300));
    const after = await db.query('SELECT 1 AS n');
    ok(after.rows[0].n === 1, 'database: a dropped idle connection is replaced, not fatal to the server');
  }

  // --- Sign-in and first admin ----------------------------------------------------------------
  // The old ADMIN_USERNAMES route is gone: a listed name signing in first is not made admin.
  process.env.ADMIN_USERNAMES = 'ann';
  ok((await auth('login', { username: 'ann', password: 'secret11' })).body.isAdmin === false, 'admin: ADMIN_USERNAMES no longer makes anyone admin');
  delete process.env.ADMIN_USERNAMES;
  const tomLogin = await auth('login', { username: 'Tom', password: 'secret11' });
  ok(tomLogin.status === 200 && tomLogin.body.isAdmin === true, 'login: Tom, the oldest account, becomes first admin');
  const T = tomLogin.body.token as string;
  const annLogin = await auth('login', { username: 'ann', password: 'secret11' });
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
  const locked = await auth('login', { username: 'ann', password: 'secret11' });
  ok(locked.status === 429, 'limit: 11th attempt refused even with the right password');
  ok((await auth('login', { username: 'ANN', password: 'secret11' })).status === 429, 'limit: applies whatever the capitals');
  ok((await auth('login', { username: 'Tom', password: 'secret11' })).status === 200, 'limit: other accounts unaffected');
  for (let i = 0; i < 10; i++) await auth('login', { username: 'nobody', password: 'x' });
  ok((await auth('login', { username: 'nobody', password: 'x' })).status === 429, 'limit: unknown usernames limited the same way');
  // A stranger's failures lock out only the stranger's network, not the player.
  ok((await auth('login', { username: 'ann', password: 'secret11' }, '10.0.0.2')).status === 200, 'limit: player still signs in from their own network');
  const recorded = await admin.query(`SELECT COUNT(*)::int AS n FROM login_failures WHERE username_key = 'nobody' AND address = '10.0.0.1'`);
  ok(recorded.rows[0].n >= 10, 'limit: failures recorded with the network address');
  // One network trying a few passwords against many accounts.
  await admin.query(`INSERT INTO login_failures (username_key, address) SELECT 'sweep' || i, '10.5.5.5' FROM generate_series(1, 30) i`);
  ok((await auth('login', { username: 'fresh-name', password: 'x' }, '10.5.5.5')).status === 429, 'limit: 30 failures from one network block it for any username');
  ok((await auth('login', { username: 'fresh-name', password: 'x' }, '10.5.5.6')).status === 401, 'limit: other networks unaffected');
  // Guessing spread across many networks.
  await admin.query(`INSERT INTO login_failures (username_key, address) SELECT 'target', '172.16.0.' || i FROM generate_series(1, 100) i`);
  ok((await auth('login', { username: 'target', password: 'x' }, '10.6.6.6')).status === 429, 'limit: 100 failures an hour for one username, from any networks, block it');
  // IPv6: one /64 is one network, so rotating addresses inside it does not reset the count.
  for (let i = 1; i <= 10; i++) await auth('login', { username: 'v6user', password: 'x' }, `2001:db8:5:6::${i.toString(16)}`);
  ok((await auth('login', { username: 'v6user', password: 'x' }, '2001:db8:5:6:ffff::1')).status === 429, 'limit: IPv6 addresses counted per /64');
  // An unknown username takes as long to refuse as a wrong password (bcrypt runs either way).
  await auth('login', { username: 'no-such-user', password: 'x' }, '10.8.8.1'); // warms the dummy hash
  let t0 = Date.now();
  await auth('login', { username: 'Tom', password: 'wrong-pass' }, '10.8.8.2');
  const known = Date.now() - t0;
  t0 = Date.now();
  await auth('login', { username: 'no-such-user-2', password: 'x' }, '10.8.8.3');
  const unknown = Date.now() - t0;
  ok(unknown > known * 0.5, `login: unknown username not answered faster (unknown ${unknown} ms, known ${known} ms)`);
  const { networkKey } = require(path.join(ROOT, 'packages/thrash-margin/api/_lib/rateLimit'));
  ok(
    networkKey('2001:0db8:0001:0002:ffff::1') === '2001:db8:1:2::/64' && networkKey('::ffff:10.1.2.3') === '10.1.2.3' && networkKey('203.0.113.7') === '203.0.113.7',
    'limit: network keys (IPv6 /64, IPv4-mapped, IPv4)',
  );

  // --- Admin: roles, password reset, audit -------------------------------------------------------
  ok((await adminApi('GET', 'users', A)).status === 403, 'admin: non-admin refused');
  ok((await adminApi('PATCH', 'users', T, { id: tom.body.userId, role: 'user' })).status === 400, 'admin: cannot change own role');
  ok((await adminApi('PATCH', 'users', T, { id: 'not-a-uuid', role: 'admin' })).status === 400, 'admin: malformed id refused');
  ok((await adminApi('POST', 'reset-password', T, { id: tom.body.userId })).status === 400, 'reset: not for your own account');

  const reset = await adminApi('POST', 'reset-password', T, { id: ann.body.userId });
  ok(reset.status === 200 && /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(reset.body.temporaryPassword), 'reset: returns a temporary password');
  ok((await auth('login', { username: 'ann', password: 'secret11' })).status === 401, 'reset: old password stops working (and lock cleared)');
  const annAgain = await auth('login', { username: 'ann', password: reset.body.temporaryPassword });
  ok(annAgain.status === 200, 'reset: temporary password signs in');

  ok((await adminApi('PATCH', 'users', T, { id: ann.body.userId, role: 'admin' })).status === 200, 'role: Tom makes ann admin');
  ok((await adminApi('GET', 'users', annAgain.body.token)).status === 200, 'role: ann has access at once, same token');
  ok((await adminApi('POST', 'reset-password', T, { id: ann.body.userId })).status === 403, 'reset: not for another admin');
  ok((await adminApi('PATCH', 'users', T, { id: ann.body.userId, role: 'user' })).status === 200, 'role: Tom removes ann');
  ok((await adminApi('GET', 'users', annAgain.body.token)).status === 403, 'role: ann loses access at once, same token');
  const recentReset = await adminApi('POST', 'reset-password', T, { id: ann.body.userId });
  ok(recentReset.status === 403 && !recentReset.body.temporaryPassword, 'reset: refused for an account demoted from admin in the last 30 days');
  ok((await adminApi('PATCH', 'feedback', T, { id: 'not-a-uuid', status: 'resolved' })).status === 400, 'admin: malformed feedback id refused, not a server error');

  // Two admins acting at once. A second connection demotes Tom and holds the lock; Tom's own request,
  // already past its admin check, must wait and then be refused, not act on a role he no longer has.
  const holder = await admin.connect();
  const carolRow = await admin.query(`SELECT id FROM users WHERE username = 'carol'`);
  await holder.query('BEGIN');
  await holder.query(`UPDATE users SET role = 'user' WHERE id = $1`, [tom.body.userId]);
  const racing = adminApi('PATCH', 'users', T, { id: carolRow.rows[0].id, role: 'admin' });
  await new Promise(r => setTimeout(r, 300));
  await holder.query('COMMIT');
  holder.release();
  const raced = await racing;
  const carolRole = await admin.query(`SELECT role FROM users WHERE username = 'carol'`);
  ok(raced.status === 403 && carolRole.rows[0].role === 'user', `role: an admin demoted mid-request is refused (got ${raced.status})`);
  await admin.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [tom.body.userId]);

  const audit = await adminApi('GET', 'audit', T);
  const actions = (audit.body.entries as { action: string; actor: string; target: string }[]).map(e => `${e.actor} ${e.action} ${e.target}`);
  ok(
    JSON.stringify(actions) === JSON.stringify(['Tom remove_admin ann', 'Tom grant_admin ann', 'Tom reset_password ann']),
    `audit: three changes recorded newest first (got ${JSON.stringify(actions)})`,
  );

  // --- Every game's saves, through the one /api/play function -------------------------------------
  const A2 = annAgain.body.token as string;
  // The Founder's Ledger is opt-in (shared/games.ts): off until an admin turns it on. Ann gets it here
  // so the checks below cover every game; the opt-in rules have their own section further down.
  const ledgerOn = await adminApi('PATCH', 'access', T, { id: annAgain.body.userId, game: 'founders_ledger', enabled: true });
  ok(ledgerOn.status === 200 && ledgerOn.body.games.includes('founders_ledger'), 'access: an opt-in game turned on for ann');
  // Tom too, so "another player cannot load it" below reaches the handler's owner check, not the 403.
  ok((await adminApi('PATCH', 'access', T, { id: tom.body.userId, game: 'founders_ledger', enabled: true })).status === 200, 'access: and for tom');
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
  for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    ok((await play('GET', k, A2)).status === 404, `play: '${k}' is an unknown game, not a hang or a crash`);
  }

  // --- Game access (Admin page) -------------------------------------------------------------------
  const allKeys = (GAMES as { key: string }[]).map(g => g.key);
  // Every game but the opt-in ones: what an account whose access was never set has.
  const defaultKeys = (GAMES as { key: string; optIn?: boolean }[]).filter(g => !g.optIn).map(g => g.key);
  const annLogin2 = await auth('login', { username: 'ann', password: reset.body.temporaryPassword });
  ok(JSON.stringify(annLogin2.body.games) === JSON.stringify(allKeys), 'access: ann has every game, the opt-in one included');
  const settings0 = await adminApi('GET', 'settings', T);
  ok(
    settings0.status === 200 && settings0.body.saved === false && JSON.stringify(settings0.body.newAccountGames) === JSON.stringify(defaultKeys),
    'access: new accounts default to every game but the opt-in ones until the setting is saved',
  );
  ok((await adminApi('PUT', 'settings', A2, { newAccountGames: ['tea_race'] })).status === 403, 'access: a non-admin cannot change the new-account setting');
  ok((await adminApi('PUT', 'settings', T, { newAccountGames: ['tea_race', 'nope'] })).status === 400, 'access: unknown game key refused');
  ok((await adminApi('PUT', 'settings', T, { newAccountGames: 'tea_race' })).status === 400, 'access: setting must be a list');
  const setTo = await adminApi('PUT', 'settings', T, { newAccountGames: ['tea_race', 'tea_race'] });
  ok(setTo.status === 200 && JSON.stringify(setTo.body.newAccountGames) === '["tea_race"]', 'access: new accounts set to The Tea Race only (duplicates folded)');
  const dave = await auth('register', { username: 'dave', email: 'dave@x.test', password: 'secret11' }, '10.6.6.6');
  ok(dave.status === 201 && JSON.stringify(dave.body.games) === '["tea_race"]', 'access: a new account starts with the saved setting');
  const D = dave.body.token as string;
  ok((await play('GET', 'tea-race', D)).status === 200, 'access: dave can open The Tea Race');
  const daveTm = await play('GET', 'thrash-margin', D);
  ok(daveTm.status === 403 && daveTm.body.code === 'no_game_access', 'access: dave is refused Thrash Margin (403)');
  ok((await play('POST', 'niccolo', D, undefined, { name: 'x' })).status === 403, 'access: dave cannot create a game he does not have');
  ok((await play('GET', 'thrash-margin', A2)).status === 200, 'access: the setting does not change existing accounts');
  ok((await play('GET', 'thrash-margin', undefined)).status === 401, 'access: no token is still 401, not 403');
  ok(JSON.stringify((await call(handlers.profile, 'GET', {}, undefined, D)).body.games) === '["tea_race"]', 'access: profile reports the account\'s games');

  // One account, one game.
  const annId2 = annLogin2.body.userId as string;
  ok((await adminApi('PATCH', 'access', A2, { id: annId2, game: 'thrash_margin', enabled: false })).status === 403, 'access: a non-admin cannot change access');
  ok((await adminApi('PATCH', 'access', T, { id: annId2, game: 'nope', enabled: false })).status === 400, 'access: unknown game refused');
  ok((await adminApi('PATCH', 'access', T, { id: annId2, game: 'thrash_margin', enabled: 'no' })).status === 400, 'access: enabled must be a boolean');
  ok((await adminApi('PATCH', 'access', T, { id: '00000000-0000-4000-8000-000000000000', game: 'thrash_margin', enabled: false })).status === 404, 'access: unknown account 404');
  const off = await adminApi('PATCH', 'access', T, { id: annId2, game: 'thrash_margin', enabled: false });
  ok(off.status === 200 && !off.body.games.includes('thrash_margin') && off.body.games.length === allKeys.length - 1, 'access: Thrash Margin turned off for ann, the rest kept');
  ok((await play('GET', 'thrash-margin', A2)).status === 403, 'access: ann refused Thrash Margin at once, same token');
  ok((await play('GET', 'tea-race', A2)).status === 200, 'access: ann keeps her other games');
  const annTmSaves = await admin.query(`SELECT COUNT(*)::int AS n FROM games WHERE owner_id = $1 AND game = 'thrash_margin'`, [annId2]);
  ok(annTmSaves.rows[0].n === 1, 'access: turning a game off keeps the saves');
  const on = await adminApi('PATCH', 'access', T, { id: annId2, game: 'thrash_margin', enabled: true });
  ok(on.status === 200 && JSON.stringify(on.body.games) === JSON.stringify(allKeys), 'access: turned back on, in the portal\'s order');
  const backList = await play('GET', 'thrash-margin', A2);
  ok(backList.status === 200 && backList.body.saves.length === 1, 'access: the save is back when the game is');

  // One game, every account.
  const allOff = await adminApi('POST', 'access-all', T, { game: 'niccolo', enabled: false });
  ok(allOff.status === 200 && allOff.body.changed >= 2, `access: Banco di Niccolò off for everyone (${allOff.body.changed} changed)`);
  ok((await play('GET', 'niccolo', A2)).status === 403 && (await play('GET', 'niccolo', T)).status === 403, 'access: everyone refused Banco di Niccolò');
  ok((await play('GET', 'tea-race', T)).status === 200, 'access: other games unaffected');
  const allOn = await adminApi('POST', 'access-all', T, { game: 'niccolo', enabled: true });
  ok(allOn.status === 200, 'access: Banco di Niccolò on for everyone');
  ok((await play('GET', 'niccolo', A2)).status === 200 && (await play('GET', 'niccolo', D)).status === 200, 'access: on for everyone includes accounts that never had it');
  ok((await play('GET', 'thrash-margin', D)).status === 403, 'access: on for everyone changes only that game');
  ok((await adminApi('POST', 'access-all', T, { game: 'niccolo' })).status === 400, 'access: enabled required');
  const listed = await adminApi('GET', 'users', T);
  const daveRow = (listed.body.users as { username: string; games: string[] }[]).find(u => u.username === 'dave');
  ok(JSON.stringify(daveRow?.games) === '["niccolo","tea_race"]', `access: the user list reports each account's games (got ${JSON.stringify(daveRow?.games)})`);
  const settings1 = await adminApi('GET', 'settings', T);
  ok(settings1.body.saved === true && JSON.stringify(settings1.body.newAccountGames) === '["tea_race"]', 'access: the new-account setting is unchanged by account changes');
  const accessAudit = (await adminApi('GET', 'audit', T)).body.entries.slice(0, 5).map((e: any) => `${e.action} ${e.target} ${e.detail}`);
  ok(
    JSON.stringify(accessAudit) === JSON.stringify([
      'grant_game (all accounts) niccolo',
      'revoke_game (all accounts) niccolo',
      'grant_game ann thrash_margin',
      'revoke_game ann thrash_margin',
      'set_new_account_games (new accounts) tea_race',
    ]),
    `access: every change recorded in the history (got ${JSON.stringify(accessAudit)})`,
  );

  // --- Opt-in games (The Founder's Ledger) -----------------------------------------------------------
  // An account whose access was never set has every game but the opt-in ones.
  await admin.query(`UPDATE users SET game_access = NULL WHERE username = 'carol'`);
  const carolIn = await auth('login', { username: 'carol', password: 'secret11' });
  const CA = carolIn.body.token as string;
  ok(JSON.stringify(carolIn.body.games) === JSON.stringify(defaultKeys), 'opt-in: an account at every game does not have the opt-in one');
  ok((await play('GET', 'founders-ledger', CA)).status === 403, 'opt-in: that account is refused it (403)');
  ok((await play('GET', 'tea-race', CA)).status === 200, 'opt-in: and keeps every ordinary game');
  // Turning an ordinary game off for everyone gives a NULL account the defaults minus that game, never the opt-in one.
  await adminApi('POST', 'access-all', T, { game: 'tea_race', enabled: false });
  const carolAfterOff = await admin.query(`SELECT game_access FROM users WHERE username = 'carol'`);
  ok(
    JSON.stringify(carolAfterOff.rows[0].game_access) === JSON.stringify(defaultKeys.filter(k => k !== 'tea_race')),
    `opt-in: an ordinary game off for everyone leaves the opt-in one off (got ${JSON.stringify(carolAfterOff.rows[0].game_access)})`,
  );
  await adminApi('POST', 'access-all', T, { game: 'tea_race', enabled: true });
  // Turning the opt-in game off for everyone leaves NULL accounts alone: they never had it.
  await admin.query(`UPDATE users SET game_access = NULL WHERE username = 'carol'`);
  await adminApi('POST', 'access-all', T, { game: 'founders_ledger', enabled: false });
  const carolStill = await admin.query(`SELECT game_access FROM users WHERE username = 'carol'`);
  ok(carolStill.rows[0].game_access === null, 'opt-in: turning it off for everyone does not rewrite accounts that never had it');
  // On for everyone reaches NULL accounts too, in the portal's order, and keeps their other games.
  const ledgerAll = await adminApi('POST', 'access-all', T, { game: 'founders_ledger', enabled: true });
  ok(ledgerAll.status === 200, 'opt-in: on for everyone');
  ok((await play('GET', 'founders-ledger', CA)).status === 200 && (await play('GET', 'founders-ledger', T)).status === 200, 'opt-in: on for everyone includes accounts at every game');
  const carolNow = await admin.query(`SELECT game_access FROM users WHERE username = 'carol'`);
  ok(JSON.stringify(carolNow.rows[0].game_access) === JSON.stringify(allKeys), `opt-in: a NULL account gets the defaults plus the opt-in game (got ${JSON.stringify(carolNow.rows[0].game_access)})`);
  await adminApi('POST', 'access-all', T, { game: 'founders_ledger', enabled: false });
  ok((await play('GET', 'founders-ledger', CA)).status === 403 && (await play('GET', 'tea-race', CA)).status === 200, 'opt-in: off for everyone again, other games kept');
  await adminApi('PATCH', 'access', T, { id: annAgain.body.userId, game: 'founders_ledger', enabled: true });
  // One ledger per account, and only a ledger is accepted as one.
  const ledgerList = await play('GET', 'founders-ledger', A2);
  ok(ledgerList.status === 200 && ledgerList.body.saves.length === 1, 'ledger: one ledger listed');
  const again = await play('POST', 'founders-ledger', A2, undefined, {});
  ok(again.status === 200 && again.body.gameId === ledgerList.body.saves[0].id, 'ledger: a second create returns the existing ledger');
  ok((await play('GET', 'founders-ledger', A2)).body.saves.length === 1, 'ledger: still one ledger');
  const notLedger = await play('PUT', 'founders-ledger', A2, ledgerList.body.saves[0].id, { state: { round: 1 } });
  ok(notLedger.status === 400, `ledger: a state that is not a ledger refused (got ${notLedger.status})`);
  const withReview = await play('PUT', 'founders-ledger', A2, ledgerList.body.saves[0].id, { state: { v: 2, reviews: [{ ts: 1 }, { ts: 2 }] } });
  ok(withReview.status === 200, 'ledger: a ledger saved');
  ok((await play('GET', 'founders-ledger', A2)).body.saves[0].turn === 2, 'ledger: the list counts its Friday reviews');

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

  // --- Storage limits ---------------------------------------------------------------------------------
  // The Founder's Ledger keeps one ledger per account, so a second create returns the first (checked
  // in its own section); it takes no names or seed to cut down.
  for (const g of (GAMES as { slug: string }[]).filter(x => x.slug !== 'founders-ledger')) {
    const odd = await play('POST', g.slug, A2, undefined, { name: 12345, humanNames: Array(500).fill('x'.repeat(5000)), seed: 'y'.repeat(10000) });
    ok(odd.status === 201, `${g.slug}: odd create body accepted with safe values, not a server error (got ${odd.status})`);
    if (odd.status === 201) {
      const st = (await play('GET', g.slug, A2, odd.body.gameId)).body.state;
      ok(JSON.stringify(st).length < 100_000, `${g.slug}: oversized names and seed cut down, not stored`);
      await play('DELETE', g.slug, A2, odd.body.gameId);
    }
  }
  const teaSaves = (await play('GET', 'tea-race', A2)).body.saves as { id: string }[];
  const teaId = teaSaves[0].id;
  const teaState = (await play('GET', 'tea-race', A2, teaId)).body.state;
  const huge = await play('PUT', 'tea-race', A2, teaId, { state: { ...teaState, padding: 'x'.repeat(600 * 1024) } });
  ok(huge.status === 413, `saves: a save over 512 KB refused (got ${huge.status})`);
  ok((await play('PUT', 'tea-race', A2, teaId, { state: teaState })).status === 200, 'saves: a normal save still accepted');
  const annId = annAgain.body.userId as string;
  await admin.query(
    `INSERT INTO games (owner_id, game, state, config) SELECT $1, 'tea_race', '{}', '{}' FROM generate_series(1, $2::int)`,
    [annId, 50 - teaSaves.length],
  );
  const full = await play('POST', 'tea-race', A2, undefined, { name: 'one too many' });
  ok(full.status === 409, `saves: a 51st game of one kind refused (got ${full.status})`);
  ok((await play('POST', 'steady-eddie', A2, undefined, { name: 'other game' })).status === 201, 'saves: the limit is per game, others unaffected');
  await admin.query(`DELETE FROM games WHERE owner_id = $1 AND state = '{}'::jsonb`, [annId]);
  // Fill the account's storage with incompressible data, then a normal save must be refused.
  await admin.query(
    `INSERT INTO games (owner_id, game, state, config)
     SELECT $1, 'steady_eddie', jsonb_build_object('blob', string_agg(md5(i::text || random()::text), '')), '{}'
     FROM generate_series(1, 830000) i`,
    [annId],
  );
  const used = await admin.query(`SELECT SUM(pg_column_size(state))::bigint AS n FROM games WHERE owner_id = $1`, [annId]);
  ok(Number(used.rows[0].n) > 25 * 1024 * 1024 - 100_000, `saves: test account filled to its 25 MB (${used.rows[0].n} bytes)`);
  const noRoom = await play('PUT', 'tea-race', A2, teaId, { state: teaState });
  ok(noRoom.status === 413, `saves: refused once the account's storage is full (got ${noRoom.status})`);
  await admin.query(`DELETE FROM games WHERE owner_id = $1 AND state ? 'blob'`, [annId]);
  ok((await play('PUT', 'tea-race', A2, teaId, { state: teaState })).status === 200, 'saves: accepted again once space is freed');

  // Delete last, so the cascade does not matter to the checks above.
  for (const g of GAMES as { slug: string }[]) {
    const list = await play('GET', g.slug, A2);
    for (const s of list.body.saves as { id: string }[]) await play('DELETE', g.slug, A2, s.id);
    ok((await play('GET', g.slug, A2)).body.saves.length === 0, `${g.slug}: delete`);
  }
  // --- Password change signs out other sessions -------------------------------------------------
  const carolLogin = await auth('login', { username: 'carol', password: 'secret11' });
  const C1 = carolLogin.body.token as string;
  await new Promise(r => setTimeout(r, 1100)); // tokens carry whole seconds; make the change strictly later
  const changed = await call(handlers.profile, 'PATCH', {}, { currentPassword: 'secret11', newPassword: 'secret22' }, C1);
  ok(changed.status === 200 && typeof changed.body.token === 'string', 'password change: returns a fresh token');
  ok((await call(handlers.profile, 'GET', {}, undefined, C1)).status === 401, 'password change: older session signed out');
  ok((await call(handlers.profile, 'GET', {}, undefined, changed.body.token)).status === 200, 'password change: fresh token works');
  ok((await call(handlers.profile, 'PATCH', {}, { currentPassword: 'secret22', newEmail: 'nope' }, changed.body.token)).status === 400, 'profile: invalid email refused');
  await new Promise(r => setTimeout(r, 1100));
  const reset2 = await adminApi('POST', 'reset-password', T, { id: carolLogin.body.userId });
  ok(reset2.status === 200, 'reset: carol reset by admin');
  ok((await call(handlers.profile, 'GET', {}, undefined, changed.body.token)).status === 401, 'reset: signs the player out everywhere');

  // --- Account deletion -------------------------------------------------------------------------------
  const tomSelf = await call(handlers.profile, 'DELETE', {}, { password: 'secret11' }, T);
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

  // --- Supabase's Data API is shut out -----------------------------------------------------------------
  // Everything above ran as the tables' owner with row-level security on, which proves the API is not
  // blocked by it. This proves the other half: the roles PostgREST uses can neither read nor write.
  const { SECURED_TABLES } = require(path.join(ROOT, 'packages/thrash-margin/api/_lib/schema'));
  const all = await admin.query(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
     WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'`,
  );
  ok(all.rows.length > 0 && all.rows.every((r: any) => r.relrowsecurity), 'data api: row-level security on every public table');
  ok(all.rows.every((r: any) => !r.relforcerowsecurity), 'data api: not forced, so the owning API is unaffected');
  ok(
    all.rows.every((r: any) => SECURED_TABLES.includes(r.relname)),
    `data api: every public table is in SECURED_TABLES (${all.rows.map((r: any) => r.relname).join(', ')})`,
  );
  for (const role of ['anon', 'authenticated']) {
    for (const sql of [
      'SELECT count(*) FROM users',
      'SELECT count(*) FROM games',
      "INSERT INTO feedback (message) VALUES ('x')",
      'DELETE FROM games',
    ]) {
      const c = await admin.connect();
      let refused = false;
      try {
        await c.query(`SET ROLE ${role}`);
        await c.query(sql);
      } catch (err: any) {
        refused = err.code === '42501'; // insufficient_privilege
      } finally {
        await c.query('RESET ROLE').catch(() => {});
        c.release();
      }
      ok(refused, `data api: ${role} refused: ${sql}`);
    }
  }

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
