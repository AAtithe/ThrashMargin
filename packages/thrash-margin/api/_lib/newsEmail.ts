import {
  accentFor,
  gameLabel,
  gamePath,
  HOUSE_ACCENT,
  kindInfo,
  paragraphs,
  type NewsDraft,
} from '../../shared/news';

// The news email. Built from the announcement's plain fields (shared/news.ts), never from HTML typed
// on the Admin page: every piece of text passes through esc() below.
//
// Written the way email has to be: one 600px table, inline styles only, no web fonts, no CSS the
// big clients strip (Gmail drops <style> in some views, Outlook renders with Word). The serif
// headings fall back through Georgia, which every client has. Colours are fixed here rather than
// the portal's CSS variables, which no email client understands; they read on light and on the
// dark backgrounds some clients force.

export interface RenderOptions {
  /** The portal's address, no trailing slash: https://example.com */
  baseUrl: string;
  /** Where this recipient's one-click unsubscribe goes. Omitted on the Admin page's preview. */
  unsubscribeUrl?: string;
  /** The piece's own page on the portal, once it has an id. */
  permalink?: string;
  /** Shown in the header and the sign-off. */
  brand: string;
  /** Publication date, for the dateline. */
  date?: Date;
}

const INK = '#14151a';
const PAPER = '#f4f1ea';
const CARD = '#ffffff';
const TEXT = '#2a2d33';
const SOFT = '#5b616b';
const FAINT = '#8a8f98';
const RULE = '#e6e1d6';
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function button(href: string, label: string, color: string): string {
  // A "bulletproof" button: a table cell with a background, so it survives Outlook.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px">
  <tr><td bgcolor="${color}" style="border-radius:6px;background:${color}">
    <a href="${esc(href)}" style="display:inline-block;padding:14px 26px;font-family:${SANS};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;letter-spacing:0.2px">${esc(label)}</a>
  </td></tr></table>`;
}

function dateline(d?: Date): string {
  return (d ?? new Date()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
}

export function renderNewsEmail(n: NewsDraft, o: RenderOptions): { subject: string; html: string; text: string } {
  const accent = accentFor(n.game);
  const kind = kindInfo(n.kind);
  const mainGame = gameLabel(n.game);
  const mainHref = n.game ? `${o.baseUrl}${gamePath(n.game)}` : o.permalink ?? `${o.baseUrl}/thrash-margin/news`;
  const mainLabel = mainGame ? `Play ${mainGame}` : 'Read it on the portal';
  const subject = n.kind === 'newsletter' ? n.title : `${kind.eyebrow}: ${n.title}`;

  const sections = n.sections
    .map((s, i) => {
      const sAccent = s.game ? accentFor(s.game) : accent;
      const label = gameLabel(s.game);
      const href = s.game ? `${o.baseUrl}${gamePath(s.game)}` : undefined;
      return `<tr><td style="padding:${i === 0 ? '8px' : '0'} 48px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td style="border-top:1px solid ${RULE};padding:30px 0 4px">
      ${label ? `<div style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${sAccent};margin:0 0 10px">${esc(label)}</div>` : ''}
      ${s.heading ? `<h2 style="margin:0 0 12px;font-family:${SERIF};font-size:23px;line-height:1.3;font-weight:normal;color:${INK}">${esc(s.heading)}</h2>` : ''}
      ${paragraphs(s.body)
        .map(p => `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.65;color:${TEXT}">${esc(p).replace(/\n/g, '<br>')}</p>`)
        .join('\n      ')}
      ${href ? `<p style="margin:0 0 8px;font-family:${SANS};font-size:15px;font-weight:600"><a href="${esc(href)}" style="color:${sAccent};text-decoration:none">Play ${esc(label!)} &rarr;</a></p>` : ''}
    </td></tr>
  </table>
</td></tr>`;
    })
    .join('\n');

  const footerLinks = [
    o.unsubscribeUrl ? `<a href="${esc(o.unsubscribeUrl)}" style="color:${SOFT};text-decoration:underline">Unsubscribe</a>` : '',
    `<a href="${esc(o.baseUrl)}/thrash-margin/profile" style="color:${SOFT};text-decoration:underline">Email preferences</a>`,
    `<a href="${esc(o.baseUrl)}/privacy.html" style="color:${SOFT};text-decoration:underline">Privacy</a>`,
  ]
    .filter(Boolean)
    .join(' &nbsp;&middot;&nbsp; ');

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPER}">${esc(n.summary)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background:${PAPER}">
<tr><td align="center" style="padding:32px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
    <tr><td bgcolor="${INK}" style="background:${INK};border-radius:10px 10px 0 0;padding:22px 48px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-family:${SERIF};font-size:15px;letter-spacing:3px;text-transform:uppercase;color:${HOUSE_ACCENT}">${esc(o.brand)}</td>
        <td align="right" style="font-family:${SANS};font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#9aa0aa">${esc(dateline(o.date))}</td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="${accent}" style="background:${accent};height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>
    <tr><td bgcolor="${CARD}" style="background:${CARD};padding:44px 48px 6px">
      <div style="font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${accent};margin:0 0 14px">${esc(kind.eyebrow)}</div>
      <h1 style="margin:0 0 16px;font-family:${SERIF};font-size:34px;line-height:1.18;font-weight:normal;color:${INK}">${esc(n.title)}</h1>
      <p style="margin:0;font-family:${SANS};font-size:18px;line-height:1.55;color:${SOFT}">${esc(n.summary)}</p>
      ${button(mainHref, mainLabel, accent)}
    </td></tr>
    <tr><td bgcolor="${CARD}" style="background:${CARD};padding:10px 0 30px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${sections}
      </table>
    </td></tr>
    <tr><td bgcolor="${CARD}" style="background:${CARD};border-radius:0 0 10px 10px;padding:0 48px 40px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="border-top:1px solid ${RULE};padding-top:26px;font-family:${SERIF};font-size:16px;font-style:italic;color:${SOFT}">See you on the board.</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:26px 48px 8px;font-family:${SANS};font-size:12px;line-height:1.6;color:${FAINT};text-align:center">
      You are receiving this because you asked for news from ${esc(o.brand)} on your Profile page.<br>
      ${footerLinks}
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

  const text = [
    `${o.brand.toUpperCase()}  |  ${kind.eyebrow.toUpperCase()}`,
    '',
    n.title,
    '',
    n.summary,
    '',
    `${mainLabel}: ${mainHref}`,
    '',
    ...n.sections.flatMap(s => [
      '----',
      ...(gameLabel(s.game) ? [gameLabel(s.game)!.toUpperCase()] : []),
      ...(s.heading ? [s.heading, ''] : []),
      ...paragraphs(s.body).flatMap(p => [p, '']),
      ...(s.game ? [`Play ${gameLabel(s.game)}: ${o.baseUrl}${gamePath(s.game)}`, ''] : []),
    ]),
    '----',
    `You are receiving this because you asked for news from ${o.brand} on your Profile page.`,
    ...(o.unsubscribeUrl ? [`Unsubscribe: ${o.unsubscribeUrl}`] : []),
    `Email preferences: ${o.baseUrl}/thrash-margin/profile`,
  ].join('\n');

  return { subject, html, text };
}
