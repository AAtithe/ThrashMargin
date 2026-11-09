import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Pool } from 'pg';
import { getDb } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { handleCors } from '../_lib/cors';
import { queryParam } from '../_lib/query';
import { ensureSchema } from '../_lib/schema';
import { isAdmin, recordAudit } from '../_lib/admin';
import { resolveAccess } from '../_lib/access';
import { renderNewsEmail } from '../_lib/newsEmail';
import { BATCH_SIZE, brand, mailConfigured, newUnsubscribeToken, sendBatch, sendOne } from '../_lib/mailer';
import { gameLabel, parseDraft, type NewsDraft } from '../../shared/news';

// /api/news/<action>: the portal's news, as one function (Vercel's Hobby plan caps the deployment
// at 12; see api/play/[kind].ts). Three audiences, checked per action:
//
//   anyone       POST unsubscribe   { token }  The link in every email. Deliberately needs no sign-in:
//                                              UK rules (PECR) and Gmail/Yahoo's sender rules require a
//                                              one-click way out. It reads nothing and can do exactly one
//                                              thing, turn that token's emails off. The token is 48 random
//                                              hex characters, unguessable, and it grants no session and
//                                              no access to any game. This is not a guest path into the
//                                              portal (CLAUDE.md, invariant 1).
//   signed in    GET  feed                     Published pieces, newest first, for the What's new page.
//                GET  prefs / PATCH prefs      The account's own email consent.
//   admin        GET  admin                    Every piece with its send counts, and whether email is set up.
//                POST save, render, publish, unpublish, delete, roundup, send-test, send

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f]{48}$/;
/** Recipients per send request, so one request stays well inside the function's time limit. */
const PER_REQUEST = BATCH_SIZE * 3;
const SEND_LOCK = 74_210_100; // advisory lock namespace for sends (schema.ts uses 74_210_031)

function baseUrl(req: VercelRequest): string {
  const configured = process.env.PORTAL_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
  const proto = req.headers['x-forwarded-proto'] ?? 'https';
  return `${Array.isArray(proto) ? proto[0] : proto}://${Array.isArray(host) ? host[0] : host}`;
}

interface Row {
  id: string;
  kind: string;
  title: string;
  summary: string;
  game: string | null;
  sections: NewsDraft['sections'];
  status: 'draft' | 'published';
  published_at: Date | null;
  created_at: Date;
  emailed_at: Date | null;
}

function toItem(r: Row) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    ...(r.game ? { game: r.game } : {}),
    sections: r.sections,
    status: r.status,
    publishedAt: r.published_at ? new Date(r.published_at).getTime() : null,
    createdAt: new Date(r.created_at).getTime(),
    emailedAt: r.emailed_at ? new Date(r.emailed_at).getTime() : null,
  };
}

const draftOf = (r: Row): NewsDraft => ({
  kind: r.kind as NewsDraft['kind'],
  title: r.title,
  summary: r.summary,
  ...(r.game ? { game: r.game } : {}),
  sections: r.sections,
});

async function load(db: Pool, id: unknown): Promise<Row | null> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  const { rows } = await db.query('SELECT * FROM announcements WHERE id = $1', [id]);
  return rows[0] ?? null;
}

async function actorName(db: { query: Pool['query'] }, userId: string): Promise<string> {
  const { rows } = await db.query('SELECT username FROM users WHERE id = $1', [userId]);
  return rows[0]?.username ?? '(unknown)';
}

// --- Anyone ---------------------------------------------------------------------------------------

async function unsubscribe(req: VercelRequest, res: VercelResponse) {
  // From the email's footer link (the unsubscribe page posts { token }) or from a mail client's
  // one-click button (RFC 8058: a POST to the List-Unsubscribe address, token in the query string).
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const token = typeof body.token === 'string' ? body.token : queryParam(req, 'token');
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return res.status(400).json({ message: 'This unsubscribe link is not valid.' });
  const db = getDb();
  await ensureSchema(db);
  const { rowCount } = await db.query(
    'UPDATE users SET marketing_opt_in = false, marketing_opt_in_at = NOW() WHERE unsubscribe_token = $1',
    [token],
  );
  if (!rowCount) return res.status(404).json({ message: 'This unsubscribe link is not recognised. The account may have been deleted.' });
  return res.json({ success: true });
}

// --- Signed in -----------------------------------------------------------------------------------

async function feed(res: VercelResponse, userId: string) {
  const db = getDb();
  const [{ rows }, access] = await Promise.all([
    db.query(`SELECT * FROM announcements WHERE status = 'published' ORDER BY published_at DESC LIMIT 30`),
    db.query('SELECT game_access FROM users WHERE id = $1', [userId]),
  ]);
  const games = resolveAccess(access.rows[0]?.game_access);
  // A piece about one game is shown only to accounts that can play it; roundups and general updates
  // to everyone. The same rule picks who it is emailed to.
  const items = (rows as Row[]).filter(r => !r.game || games.includes(r.game)).map(toItem);
  return res.json({ items });
}

async function getPrefs(res: VercelResponse, userId: string) {
  const { rows } = await getDb().query('SELECT marketing_opt_in FROM users WHERE id = $1', [userId]);
  return res.json({ emailOptIn: rows[0]?.marketing_opt_in === true });
}

async function setPrefs(req: VercelRequest, res: VercelResponse, userId: string) {
  const on = (req.body ?? {}).emailOptIn;
  if (typeof on !== 'boolean') return res.status(400).json({ message: 'emailOptIn (true|false) required' });
  await getDb().query(
    `UPDATE users SET marketing_opt_in = $1, marketing_opt_in_at = NOW(),
       unsubscribe_token = COALESCE(unsubscribe_token, $2)
     WHERE id = $3`,
    [on, newUnsubscribeToken(), userId],
  );
  return res.json({ emailOptIn: on });
}

// --- Admin ---------------------------------------------------------------------------------------

/** Accounts a piece would be emailed to: active, opted in, and (for a piece about one game) able to play it. */
async function audience(db: { query: Pool['query'] }, r: { id: string; game: string | null }, onlyUnsent: boolean) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.unsubscribe_token, u.game_access FROM users u
     WHERE u.status = 'active' AND u.marketing_opt_in AND u.email IS NOT NULL
       ${onlyUnsent ? `AND NOT EXISTS (SELECT 1 FROM email_sends s WHERE s.announcement_id = $1 AND s.user_id = u.id AND s.status = 'sent')` : ''}
     ORDER BY u.created_at`,
    onlyUnsent ? [r.id] : [],
  );
  return rows.filter(u => !r.game || resolveAccess(u.game_access).includes(r.game));
}

async function adminList(req: VercelRequest, res: VercelResponse) {
  const db = getDb();
  const { rows } = await db.query(
    `SELECT a.*,
       (SELECT COUNT(*) FROM email_sends s WHERE s.announcement_id = a.id AND s.status = 'sent')::int AS sent,
       (SELECT COUNT(*) FROM email_sends s WHERE s.announcement_id = a.id AND s.status = 'failed')::int AS failed
     FROM announcements a ORDER BY COALESCE(a.published_at, a.updated_at) DESC LIMIT 100`,
  );
  const { rows: subs } = await db.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE status = 'active' AND marketing_opt_in`,
  );
  const items = await Promise.all(
    (rows as (Row & { sent: number; failed: number })[]).map(async r => ({
      ...toItem(r),
      sent: r.sent,
      failed: r.failed,
      audience: (await audience(db, r, false)).length,
    })),
  );
  return res.json({ items, emailConfigured: mailConfigured(), subscribers: subs[0].n, baseUrl: baseUrl(req) });
}

async function save(req: VercelRequest, res: VercelResponse, callerId: string) {
  const draft = parseDraft(req.body);
  if (typeof draft === 'string') return res.status(400).json({ message: draft });
  const db = getDb();
  const id = (req.body ?? {}).id;
  const values = [draft.kind, draft.title, draft.summary, draft.game ?? null, JSON.stringify(draft.sections)];
  if (id !== undefined) {
    if (!(await load(db, id))) return res.status(404).json({ message: 'Not found' });
    const { rows } = await db.query(
      `UPDATE announcements SET kind = $1, title = $2, summary = $3, game = $4, sections = $5::jsonb, updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [...values, id],
    );
    return res.json({ item: toItem(rows[0]) });
  }
  const { rows } = await db.query(
    `INSERT INTO announcements (kind, title, summary, game, sections, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
    [...values, callerId],
  );
  return res.status(201).json({ item: toItem(rows[0]) });
}

async function render(req: VercelRequest, res: VercelResponse) {
  const draft = parseDraft(req.body);
  if (typeof draft === 'string') return res.status(400).json({ message: draft });
  const { subject, html } = renderNewsEmail(draft, { baseUrl: baseUrl(req), brand: brand() });
  return res.json({ subject, html });
}

async function setStatus(req: VercelRequest, res: VercelResponse, status: 'draft' | 'published') {
  const db = getDb();
  const r = await load(db, (req.body ?? {}).id);
  if (!r) return res.status(404).json({ message: 'Not found' });
  const { rows } = await db.query(
    `UPDATE announcements SET status = $1::varchar,
       published_at = CASE WHEN $1::varchar = 'published' THEN COALESCE(published_at, NOW()) ELSE published_at END,
       updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [status, r.id],
  );
  return res.json({ item: toItem(rows[0]) });
}

async function remove(req: VercelRequest, res: VercelResponse) {
  const db = getDb();
  const r = await load(db, (req.body ?? {}).id);
  if (!r) return res.status(404).json({ message: 'Not found' });
  if (r.status === 'published') return res.status(409).json({ message: 'Unpublish it first.' });
  if (r.emailed_at) return res.status(409).json({ message: 'It has been emailed, so it is kept as a record.' });
  await db.query('DELETE FROM announcements WHERE id = $1', [r.id]);
  return res.json({ success: true });
}

// A draft roundup from everything published since the last roundup (or in the last 31 days):
// one section per piece, with its summary. The admin edits it before publishing.
async function roundup(res: VercelResponse, callerId: string) {
  const db = getDb();
  const { rows: last } = await db.query(
    `SELECT MAX(published_at) AS at FROM announcements WHERE kind = 'newsletter' AND status = 'published'`,
  );
  const since: Date = last[0]?.at ?? new Date(Date.now() - 31 * 864e5);
  const { rows } = await db.query(
    `SELECT * FROM announcements WHERE status = 'published' AND kind <> 'newsletter' AND published_at > $1
     ORDER BY published_at ASC`,
    [since],
  );
  const month = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' });
  const sections = (rows as Row[]).map(r => ({ heading: r.title, body: r.summary, ...(r.game ? { game: r.game } : {}) }));
  if (!sections.length) {
    sections.push({ heading: 'This month on the portal', body: 'Write what happened this month here.' });
  }
  const names = [...new Set((rows as Row[]).map(r => gameLabel(r.game ?? undefined)).filter(Boolean))];
  const summary = rows.length
    ? `${rows.length} ${rows.length === 1 ? 'thing' : 'things'} shipped since the last roundup${names.length ? `, across ${names.join(', ')}` : ''}.`
    : 'Everything new on the portal this month.';
  const { rows: made } = await db.query(
    `INSERT INTO announcements (kind, title, summary, sections, created_by)
     VALUES ('newsletter', $1, $2, $3::jsonb, $4) RETURNING *`,
    [`The ${month} roundup`, summary, JSON.stringify(sections), callerId],
  );
  return res.status(201).json({ item: toItem(made[0]) });
}

async function sendTest(req: VercelRequest, res: VercelResponse, callerId: string) {
  if (!mailConfigured()) return res.status(503).json({ message: 'Email is not set up yet: add RESEND_API_KEY and NEWS_FROM in Vercel.' });
  const db = getDb();
  const r = await load(db, (req.body ?? {}).id);
  if (!r) return res.status(404).json({ message: 'Not found' });
  const { rows } = await db.query('SELECT email FROM users WHERE id = $1', [callerId]);
  const to = rows[0]?.email;
  if (!to) return res.status(400).json({ message: 'Your account has no email address.' });
  const base = baseUrl(req);
  const email = renderNewsEmail(draftOf(r), { baseUrl: base, brand: brand(), permalink: `${base}/thrash-margin/news/${r.id}`, date: r.published_at ?? undefined });
  const out = await sendOne({ to, subject: `[Test] ${email.subject}`, html: email.html, text: email.text });
  await db.query(
    `INSERT INTO email_sends (announcement_id, user_id, email, status, provider_id, error) VALUES ($1, $2, $3, 'test', $4, $5)`,
    [r.id, callerId, to, out.ok ? out.id : null, out.ok ? null : out.error],
  );
  if (!out.ok) return res.status(502).json({ message: `The email service refused it: ${out.error}` });
  return res.json({ sentTo: to });
}

// Sends a published piece to everyone in its audience who has not had it yet, PER_REQUEST at a time;
// the Admin page calls again while `remaining` is above zero. Each batch's rows are written as soon
// as it returns, and the next call skips anyone already sent to, so a send interrupted at any point
// resumes without a duplicate. An advisory lock stops two admins sending the same piece at once.
async function send(req: VercelRequest, res: VercelResponse, callerId: string) {
  if (!mailConfigured()) return res.status(503).json({ message: 'Email is not set up yet: add RESEND_API_KEY and NEWS_FROM in Vercel.' });
  const db = getDb();
  const r = await load(db, (req.body ?? {}).id);
  if (!r) return res.status(404).json({ message: 'Not found' });
  if (r.status !== 'published') return res.status(409).json({ message: 'Publish it first, so the email matches what is on the portal.' });

  // The pool has one connection (_lib/db.ts): everything from here on uses this one, never getDb().
  const c = await db.connect();
  const lockKey = SEND_LOCK;
  let locked = false;
  try {
    const { rows: got } = await c.query('SELECT pg_try_advisory_lock($1, hashtext($2)) AS ok', [lockKey, r.id]);
    locked = got[0].ok;
    if (!locked) return res.status(409).json({ message: 'This piece is already being sent. Wait for that to finish.' });

    // Anyone opted in without a token yet (consent given before tokens existed) gets one now.
    const { rows: missing } = await c.query(`SELECT id FROM users WHERE marketing_opt_in AND unsubscribe_token IS NULL`);
    for (const m of missing) {
      await c.query('UPDATE users SET unsubscribe_token = $1 WHERE id = $2 AND unsubscribe_token IS NULL', [newUnsubscribeToken(), m.id]);
    }

    const everyone = await audience(c, r, true);
    const now = everyone.slice(0, PER_REQUEST);
    const base = baseUrl(req);
    const draft = draftOf(r);
    let sent = 0;
    let failed = 0;
    let lastError: string | null = null;
    for (let i = 0; i < now.length; i += BATCH_SIZE) {
      const batch = now.slice(i, i + BATCH_SIZE);
      const messages = batch.map(u => {
        const unsubscribeUrl = `${base}/api/news/unsubscribe?token=${u.unsubscribe_token}`;
        const email = renderNewsEmail(draft, {
          baseUrl: base,
          brand: brand(),
          permalink: `${base}/thrash-margin/news/${r.id}`,
          unsubscribeUrl: `${base}/unsubscribe.html?token=${u.unsubscribe_token}`,
          date: r.published_at ?? undefined,
        });
        return { to: u.email, subject: email.subject, html: email.html, text: email.text, unsubscribeUrl };
      });
      const results = await sendBatch(messages);
      for (let k = 0; k < batch.length; k++) {
        const out = results[k];
        await c.query(
          `INSERT INTO email_sends (announcement_id, user_id, email, status, provider_id, error)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [r.id, batch[k].id, batch[k].email, out.ok ? 'sent' : 'failed', out.ok ? out.id : null, out.ok ? null : out.error],
        );
        if (out.ok) sent++;
        else {
          failed++;
          lastError = out.error;
        }
      }
      if (failed && !sent) break; // the service is refusing everything: stop rather than try every batch
    }
    // Failed rows are not 'sent', so they are still in the audience: the next call retries them.
    const remaining = everyone.length - sent;
    if (!remaining) await c.query('UPDATE announcements SET emailed_at = COALESCE(emailed_at, NOW()) WHERE id = $1', [r.id]);
    if (sent) {
      await recordAudit(c, {
        actorId: callerId,
        actorUsername: await actorName(c, callerId),
        targetId: null,
        targetUsername: '(subscribers)',
        action: 'send_news',
        detail: `${r.title} (${sent} sent${failed ? `, ${failed} failed` : ''})`,
      });
    }
    return res.json({ sent, failed, remaining, error: lastError });
  } finally {
    if (locked) await c.query('SELECT pg_advisory_unlock($1, hashtext($2))', [lockKey, r.id]).catch(() => {});
    c.release();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  const action = queryParam(req, 'action');

  try {
    if (action === 'unsubscribe' && req.method === 'POST') return await unsubscribe(req, res);

    const user = await requireUser(req, res);
    if (!user) return;
    if (action === 'feed' && req.method === 'GET') return await feed(res, user.userId);
    if (action === 'prefs' && req.method === 'GET') return await getPrefs(res, user.userId);
    if (action === 'prefs' && req.method === 'PATCH') return await setPrefs(req, res, user.userId);

    const db = getDb();
    const adminActions = ['admin', 'save', 'render', 'publish', 'unpublish', 'delete', 'roundup', 'send-test', 'send'];
    if (!action || !adminActions.includes(action)) return res.status(404).json({ message: 'Not found' });
    if (!(await isAdmin(db, user.userId))) return res.status(403).json({ message: 'Admin access only' });

    if (action === 'admin' && req.method === 'GET') return await adminList(req, res);
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
    if (action === 'save') return await save(req, res, user.userId);
    if (action === 'render') return await render(req, res);
    if (action === 'publish') return await setStatus(req, res, 'published');
    if (action === 'unpublish') return await setStatus(req, res, 'draft');
    if (action === 'delete') return await remove(req, res);
    if (action === 'roundup') return await roundup(res, user.userId);
    if (action === 'send-test') return await sendTest(req, res, user.userId);
    if (action === 'send') return await send(req, res, user.userId);
    return res.status(404).json({ message: 'Not found' });
  } catch (err) {
    console.error(`news ${action} error`, err);
    return res.status(500).json({ message: 'Server error' });
  }
}
