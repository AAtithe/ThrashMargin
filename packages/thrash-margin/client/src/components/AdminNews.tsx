import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { getToken } from '../lib/token';
import { GAMES } from 'shared/games';
import { kindInfo, LIMITS, NEWS_KINDS, type NewsDraft, type NewsItem, type NewsSection } from 'shared/news';

const API = import.meta.env.VITE_API_URL ?? '';

interface AdminItem extends NewsItem {
  emailedAt: number | null;
  sent: number;
  failed: number;
  /** How many accounts it would go to now: opted in, active, and able to play its game. */
  audience: number;
}

interface Listing {
  items: AdminItem[];
  emailConfigured: boolean;
  subscribers: number;
}

type Editing = NewsDraft & { id?: string };

const BLANK: Editing = { kind: 'update', title: '', summary: '', sections: [{ heading: '', body: '' }] };

function headers(): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` };
}

async function call(action: string, body?: unknown, method = 'POST'): Promise<{ ok: boolean; data: any }> {
  try {
    const r = await fetch(`${API}/api/news/${action}`, { method, headers: headers(), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: { message: 'Could not reach the server, try again' } };
  }
}

function fmt(ms: number | null): string {
  return ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/**
 * The Admin page's News tab: write a piece, see the email exactly as it will arrive, publish it to
 * the What's new page, then email it to the accounts that asked for news. Sending is a separate,
 * confirmed step after publishing, so nothing is emailed by accident, and nothing is emailed that
 * players cannot also read on the portal.
 */
export default function AdminNews({ onChange }: { onChange?: () => void }) {
  const [list, setList] = useState<Listing | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const r = await call('admin', undefined, 'GET');
    if (r.ok) setList(r.data);
    else setNotice({ tone: 'bad', text: r.data.message ?? 'Could not load the news' });
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Live preview of the email, a moment after typing stops.
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!editing) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const r = await call('render', editing);
      if (r.ok) { setPreview(r.data); setPreviewError(null); }
      else setPreviewError(r.data.message ?? 'Preview unavailable');
    }, 450);
    return () => window.clearTimeout(timer.current);
  }, [editing]);

  const say = (tone: 'good' | 'bad', text: string) => setNotice({ tone, text });

  const save = async (andPublish: boolean) => {
    if (!editing) return;
    setBusy('save');
    const r = await call('save', editing);
    if (!r.ok) { setBusy(null); return say('bad', r.data.message ?? 'Could not save'); }
    if (andPublish) {
      const p = await call('publish', { id: r.data.item.id });
      if (!p.ok) { setBusy(null); return say('bad', p.data.message ?? 'Saved, but could not publish'); }
    }
    setBusy(null);
    setEditing(null);
    setPreview(null);
    say('good', andPublish ? 'Published. It is on the What\'s new page now; email it from the list when ready.' : 'Draft saved.');
    await refresh();
    onChange?.();
  };

  const act = async (item: AdminItem, action: 'publish' | 'unpublish' | 'delete') => {
    if (action === 'delete' && !window.confirm(`Delete the draft "${item.title}"?`)) return;
    if (action === 'unpublish' && !window.confirm(`Take "${item.title}" off the What's new page? Emails already sent cannot be recalled.`)) return;
    setBusy(`${action}:${item.id}`);
    const r = await call(action, { id: item.id });
    setBusy(null);
    if (!r.ok) return say('bad', r.data.message ?? 'That did not work');
    say('good', action === 'publish' ? 'Published.' : action === 'unpublish' ? 'Moved back to drafts.' : 'Deleted.');
    await refresh();
    onChange?.();
  };

  const sendTest = async (item: AdminItem) => {
    setBusy(`test:${item.id}`);
    const r = await call('send-test', { id: item.id });
    setBusy(null);
    if (!r.ok) return say('bad', r.data.message ?? 'The test was not sent');
    say('good', `Test sent to ${r.data.sentTo}. Check how it looks before sending it to everyone.`);
  };

  const send = async (item: AdminItem) => {
    const left = item.audience - item.sent;
    if (!window.confirm(`Email "${item.title}" to ${left} ${left === 1 ? 'person' : 'people'}? An email cannot be recalled once sent.`)) return;
    setBusy(`send:${item.id}`);
    let total = 0;
    // The server sends a few hundred per request and says how many remain; carry on until done, or
    // until a request sends nothing (the service refused: stop rather than loop).
    for (let guard = 0; guard < 100; guard++) {
      const r = await call('send', { id: item.id });
      if (!r.ok) { setBusy(null); await refresh(); return say('bad', r.data.message ?? 'The send stopped'); }
      total += r.data.sent;
      setNotice({ tone: 'good', text: `Sending… ${total} sent${r.data.remaining ? `, ${r.data.remaining} to go` : ''}` });
      if (r.data.failed && !r.data.sent) {
        setBusy(null);
        await refresh();
        return say('bad', `The email service refused the send: ${r.data.error ?? 'no reason given'}. ${total} sent so far; send again to retry the rest.`);
      }
      if (!r.data.remaining) break;
    }
    setBusy(null);
    say('good', `Sent to ${total} ${total === 1 ? 'person' : 'people'}.`);
    await refresh();
    onChange?.();
  };

  const roundup = async () => {
    setBusy('roundup');
    const r = await call('roundup', {});
    setBusy(null);
    if (!r.ok) return say('bad', r.data.message ?? 'Could not draft the roundup');
    const it = r.data.item as NewsItem;
    setEditing({ id: it.id, kind: it.kind, title: it.title, summary: it.summary, game: it.game, sections: it.sections });
    say('good', 'Roundup drafted from everything published since the last one. Edit it, then publish.');
    await refresh();
  };

  const startEdit = (it?: AdminItem) => {
    setNotice(null);
    setPreview(null);
    setEditing(it ? { id: it.id, kind: it.kind, title: it.title, summary: it.summary, game: it.game, sections: it.sections } : { ...BLANK, sections: [{ heading: '', body: '' }] });
    window.scrollTo({ top: 0 });
  };

  const setSection = (i: number, patch: Partial<NewsSection>) =>
    setEditing(e => e && { ...e, sections: e.sections.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const moveSection = (i: number, d: -1 | 1) =>
    setEditing(e => {
      if (!e || i + d < 0 || i + d >= e.sections.length) return e;
      const next = [...e.sections];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return { ...e, sections: next };
    });

  if (!list) return <p style={{ color: 'var(--portal-soft)', fontSize: 13 }}>{notice?.text ?? 'Loading…'}</p>;

  return (
    <div>
      <div style={s.head}>
        <div>
          <h2 style={{ ...s.h2, margin: 0 }}>News and email</h2>
          <p style={s.help}>
            {list.subscribers} {list.subscribers === 1 ? 'account has' : 'accounts have'} asked for news by email.
            Publish puts a piece on the What's new page; Send emails it, as a separate step.
          </p>
        </div>
        {!editing && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={s.primary} onClick={() => startEdit()}>New piece</button>
            <button style={s.secondary} onClick={roundup} disabled={busy === 'roundup'}>Draft this month's roundup</button>
          </div>
        )}
      </div>

      {!list.emailConfigured && (
        <div style={s.warn} data-testid="email-not-configured">
          Email sending is off until <code>RESEND_API_KEY</code> and <code>NEWS_FROM</code> are set in Vercel (and
          <code> PORTAL_URL</code>, for the links). Everything else works now: write, preview and publish.
        </div>
      )}
      {notice && <p style={{ ...s.notice, color: notice.tone === 'good' ? 'var(--portal-good)' : 'var(--portal-bad)' }} role="status">{notice.text}</p>}

      {editing && (
        <div style={s.editor} data-testid="news-editor">
          <div style={s.form}>
            <div style={s.row}>
              <label style={s.label}>Kind
                <select style={s.input} value={editing.kind} onChange={e => setEditing({ ...editing, kind: e.target.value as NewsDraft['kind'] })}>
                  {NEWS_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
                </select>
              </label>
              <label style={s.label}>About a game
                <select style={s.input} value={editing.game ?? ''} onChange={e => setEditing({ ...editing, game: e.target.value || undefined })}>
                  <option value="">None (the whole portal)</option>
                  {GAMES.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
              </label>
            </div>
            {editing.game && <p style={s.hint}>Shown to, and emailed to, only accounts that can play it.</p>}
            <label style={s.label}>Title
              <input style={s.input} value={editing.title} maxLength={LIMITS.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Fireline is live" />
            </label>
            <label style={s.label}>Summary <span style={s.faint}>(the teaser, and the line inboxes show under the subject)</span>
              <textarea style={{ ...s.input, minHeight: 64 }} value={editing.summary} maxLength={LIMITS.summary} onChange={e => setEditing({ ...editing, summary: e.target.value })} />
            </label>

            {editing.sections.map((sec, i) => (
              <fieldset key={i} style={s.fieldset} data-section={i}>
                <legend style={s.legend}>Section {i + 1}</legend>
                <div style={s.row}>
                  <input style={{ ...s.input, flex: 2 }} placeholder="Heading" value={sec.heading} maxLength={LIMITS.heading} onChange={e => setSection(i, { heading: e.target.value })} />
                  <select style={{ ...s.input, flex: 1 }} value={sec.game ?? ''} onChange={e => setSection(i, { game: e.target.value || undefined })} aria-label={`Section ${i + 1} game`}>
                    <option value="">No game link</option>
                    {GAMES.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
                  </select>
                </div>
                <textarea style={{ ...s.input, minHeight: 110 }} placeholder="Text. A blank line starts a new paragraph." value={sec.body} maxLength={LIMITS.body} onChange={e => setSection(i, { body: e.target.value })} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" style={s.small} onClick={() => moveSection(i, -1)} disabled={i === 0}>Move up</button>
                  <button type="button" style={s.small} onClick={() => moveSection(i, 1)} disabled={i === editing.sections.length - 1}>Move down</button>
                  <button type="button" style={s.small} onClick={() => setEditing({ ...editing, sections: editing.sections.filter((_, k) => k !== i) })} disabled={editing.sections.length === 1}>Remove</button>
                </div>
              </fieldset>
            ))}
            {editing.sections.length < LIMITS.sections && (
              <button type="button" style={s.secondary} onClick={() => setEditing({ ...editing, sections: [...editing.sections, { heading: '', body: '' }] })}>Add a section</button>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <button style={s.primary} onClick={() => save(true)} disabled={!!busy}>Save and publish</button>
              <button style={s.secondary} onClick={() => save(false)} disabled={!!busy}>Save as draft</button>
              <button style={s.ghost} onClick={() => { setEditing(null); setPreview(null); }}>Cancel</button>
            </div>
          </div>

          <div style={s.previewCol}>
            <div style={s.previewLabel}>Email preview</div>
            {preview ? (
              <>
                <div style={s.subject}><span style={s.faint}>Subject</span> {preview.subject}</div>
                {/* The email exactly as rendered by the server: built only from escaped text, never from typed HTML. */}
                <div style={s.previewFrame} data-testid="news-preview" dangerouslySetInnerHTML={{ __html: preview.html }} />
              </>
            ) : (
              <p style={s.hint}>{previewError ?? 'Start writing and the email appears here.'}</p>
            )}
          </div>
        </div>
      )}

      {!editing && (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>{['Piece', 'Status', 'Email', ''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {list.items.map(it => {
                const left = Math.max(0, it.audience - it.sent);
                return (
                  <tr key={it.id} data-news-row={it.title}>
                    <td style={s.td}>
                      <div style={{ fontWeight: 600, color: 'var(--portal-text)' }}>{it.title}</div>
                      <div style={s.faint}>{kindInfo(it.kind).label}{it.game ? ` · ${GAMES.find(g => g.key === it.game)?.label}` : ''}</div>
                    </td>
                    <td style={s.td}>
                      <span style={it.status === 'published' ? s.live : s.draft}>{it.status === 'published' ? 'Published' : 'Draft'}</span>
                      <div style={s.faint}>{fmt(it.publishedAt)}</div>
                    </td>
                    <td style={s.td}>
                      {it.sent ? `Sent to ${it.sent}` : 'Not sent'}
                      {it.failed > 0 && <div style={{ color: 'var(--portal-bad)', fontSize: 11 }}>{it.failed} failed</div>}
                      {it.status === 'published' && left > 0 && <div style={s.faint}>{left} still to send</div>}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button style={s.small} onClick={() => startEdit(it)}>Edit</button>
                      {it.status === 'draft' ? (
                        <button style={s.small} onClick={() => act(it, 'publish')} disabled={!!busy}>Publish</button>
                      ) : (
                        <button style={s.small} onClick={() => act(it, 'unpublish')} disabled={!!busy}>Unpublish</button>
                      )}
                      <button style={s.small} onClick={() => sendTest(it)} disabled={!!busy || !list.emailConfigured}>Send me a test</button>
                      {it.status === 'published' && (
                        <button style={s.send} onClick={() => send(it)} disabled={!!busy || !list.emailConfigured || left === 0}>
                          {busy === `send:${it.id}` ? 'Sending…' : left === 0 ? 'All sent' : `Email ${left}`}
                        </button>
                      )}
                      {it.status === 'draft' && !it.emailedAt && (
                        <button style={s.danger} onClick={() => act(it, 'delete')} disabled={!!busy}>Delete</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!list.items.length && (
                <tr><td style={s.td} colSpan={4}>Nothing written yet. Start with "New piece", or draft the monthly roundup.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const btn: CSSProperties = { borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const s: Record<string, CSSProperties> = {
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 14 },
  h2: { fontSize: 15, fontWeight: 700, color: 'var(--portal-softer)', textTransform: 'uppercase', letterSpacing: 0.5 },
  help: { color: 'var(--portal-soft)', fontSize: 13, lineHeight: 1.55, margin: '6px 0 0', maxWidth: 640 },
  hint: { color: 'var(--portal-soft)', fontSize: 12, margin: 0 },
  faint: { color: 'var(--portal-faint)', fontSize: 11, fontWeight: 400 },
  warn: { background: 'var(--portal-panel)', border: '1px solid var(--portal-warn)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--portal-text)', marginBottom: 14, lineHeight: 1.5 },
  notice: { fontSize: 13, margin: '0 0 14px' },
  primary: { ...btn, background: 'var(--portal-action)', color: 'var(--portal-ground)', border: '1px solid var(--portal-action)' },
  secondary: { ...btn, background: 'none', color: 'var(--portal-text)', border: '1px solid var(--portal-rule)' },
  ghost: { ...btn, background: 'none', color: 'var(--portal-soft)', border: '1px solid transparent' },
  small: { marginLeft: 6, background: 'none', border: '1px solid var(--portal-rule)', color: 'var(--portal-softer)', borderRadius: 5, padding: '3px 9px', fontSize: 11, cursor: 'pointer' },
  send: { marginLeft: 6, background: 'none', border: '1px solid var(--portal-good-rule)', color: 'var(--portal-good)', borderRadius: 5, padding: '3px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
  danger: { marginLeft: 6, background: 'none', border: '1px solid var(--portal-bad)', color: 'var(--portal-bad)', borderRadius: 5, padding: '3px 9px', fontSize: 11, cursor: 'pointer' },
  editor: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24, alignItems: 'start' },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  row: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  label: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--portal-softer)', flex: 1, minWidth: 160 },
  input: { background: 'var(--portal-panel)', border: '1px solid var(--portal-rule)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: 'var(--portal-text)', fontFamily: 'inherit', fontWeight: 400 },
  fieldset: { border: '1px solid var(--portal-rule)', borderRadius: 8, padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8, margin: 0 },
  legend: { fontSize: 11, fontWeight: 700, color: 'var(--portal-soft)', textTransform: 'uppercase', letterSpacing: 0.4, padding: '0 4px' },
  previewCol: { position: 'sticky', top: 16 },
  previewLabel: { fontSize: 11, fontWeight: 700, color: 'var(--portal-soft)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  subject: { fontSize: 13, color: 'var(--portal-text)', marginBottom: 8 },
  previewFrame: { background: 'var(--news-paper)', borderRadius: 8, border: '1px solid var(--portal-rule)', maxHeight: '78vh', overflow: 'auto' },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--portal-rule)', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '9px 12px', background: 'var(--portal-panel)', color: 'var(--portal-soft)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid var(--portal-rule)' },
  td: { padding: '10px 12px', borderBottom: '1px solid var(--portal-raised)', color: 'var(--portal-text-mid)', verticalAlign: 'top' },
  live: { fontSize: 11, fontWeight: 700, color: 'var(--portal-good)', textTransform: 'uppercase', letterSpacing: 0.4 },
  draft: { fontSize: 11, fontWeight: 700, color: 'var(--portal-soft)', textTransform: 'uppercase', letterSpacing: 0.4 },
};
