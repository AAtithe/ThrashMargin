// Sends email through Resend (https://resend.com), over its HTTP API with plain fetch: no SDK, so
// nothing new in the bundle and nothing to keep up to date.
//
// Configured by three environment variables, set in Vercel:
//   RESEND_API_KEY   the API key. Without it, sending is off and the Admin page says so; everything
//                    else about the news (drafting, previews, the What's new page) still works.
//   NEWS_FROM        the sender, on a domain verified in Resend: "The Games Portal <news@example.com>".
//   PORTAL_URL       the portal's public address, for the links in each email: https://example.com
//                    (falls back to the address the admin's own request came in on).
// And one optional one:
//   NEWS_BRAND       the name in the email's header and footer. Defaults to "The Games Portal".

import { randomBytes } from 'crypto';

/** The token in an account's unsubscribe links: 48 hex characters, unguessable, single-purpose. */
export function newUnsubscribeToken(): string {
  return randomBytes(24).toString('hex');
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** One-click unsubscribe (RFC 8058): Gmail and Yahoo show it as an Unsubscribe button. */
  unsubscribeUrl?: string;
}

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string };

const API = 'https://api.resend.com';
export const BATCH_SIZE = 100; // Resend's batch limit

export function mailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.NEWS_FROM;
}

export function brand(): string {
  return process.env.NEWS_BRAND?.trim() || 'The Games Portal';
}

function payload(m: OutgoingEmail) {
  return {
    from: process.env.NEWS_FROM,
    to: [m.to],
    subject: m.subject,
    html: m.html,
    text: m.text,
    ...(m.unsubscribeUrl
      ? { headers: { 'List-Unsubscribe': `<${m.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }
      : {}),
  };
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}

function describe(status: number, data: any): string {
  return String(data?.message ?? data?.error ?? `HTTP ${status}`).slice(0, 500);
}

/** Up to BATCH_SIZE emails in one call. Resend accepts or refuses a batch as a whole. */
export async function sendBatch(messages: OutgoingEmail[]): Promise<SendResult[]> {
  if (!mailConfigured()) return messages.map(() => ({ ok: false, error: 'Email is not configured' }));
  try {
    const r = await post('/emails/batch', messages.map(payload));
    if (!r.ok) return messages.map(() => ({ ok: false, error: describe(r.status, r.data) }));
    const ids: unknown[] = Array.isArray(r.data?.data) ? r.data.data : [];
    return messages.map((_, i) => ({ ok: true, id: (ids[i] as any)?.id ?? null }));
  } catch (err) {
    return messages.map(() => ({ ok: false, error: `Could not reach the email service: ${(err as Error).message}`.slice(0, 500) }));
  }
}

export async function sendOne(message: OutgoingEmail): Promise<SendResult> {
  if (!mailConfigured()) return { ok: false, error: 'Email is not configured' };
  try {
    const r = await post('/emails', payload(message));
    return r.ok ? { ok: true, id: r.data?.id ?? null } : { ok: false, error: describe(r.status, r.data) };
  } catch (err) {
    return { ok: false, error: `Could not reach the email service: ${(err as Error).message}`.slice(0, 500) };
  }
}
