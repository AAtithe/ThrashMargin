import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getStoredUser, getToken } from '../lib/token';
import PortalNav from '../components/PortalNav';
import NewsEmailToggle from '../components/NewsEmailToggle';
import { gameLabel, gamePath, kindInfo, paragraphs, type NewsItem } from 'shared/news';

const API = import.meta.env.VITE_API_URL ?? '';
const SERIF = "Georgia, 'Times New Roman', Times, serif";

/** A game's accent as a token (styles.css), so it follows light and dark mode. */
const accent = (game?: string) => (game ? `var(--news-accent-${game}, var(--news-house))` : 'var(--news-house)');

function fmt(ms: number | null): string {
  return ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/**
 * What's new: every published announcement, newest first, at /thrash-margin/news; one in full at
 * /thrash-margin/news/<id>. The same pieces the emails carry (shared/news.ts), for everyone, whether
 * or not they asked for the emails. Signed-in only, like the rest of the portal.
 */
export default function News() {
  const { id } = useParams();
  const nav = useNavigate();
  const user = getStoredUser();
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetch(`${API}/api/news/feed`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setItems(d.items ?? []))
      .catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  if (!user) {
    return (
      <Shell>
        <div style={{ ...s.centre, minHeight: '60vh' }}>
          <p style={{ color: 'var(--news-soft)' }}>Sign in to read the portal's news.</p>
          <button style={s.cta('var(--news-house)')} onClick={() => nav('/login?next=/thrash-margin/news')}>Sign in</button>
        </div>
      </Shell>
    );
  }

  const open = id ? items?.find(i => i.id === id) : undefined;

  return (
    <Shell>
      <header style={s.masthead}>
        <div style={s.mastInner}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={s.wordmark}>What's new</div>
            <h1 style={s.mastTitle}>News from the portal</h1>
            <p style={s.mastSub}>New games, features as they ship, and the monthly roundup.</p>
          </div>
          <div style={s.optin}>
            <NewsEmailToggle />
          </div>
        </div>
      </header>

      <main style={s.main}>
        {error && <p style={{ color: 'var(--portal-bad)' }}>The news could not be loaded. Refresh to try again.</p>}
        {!error && !items && <p style={{ color: 'var(--news-soft)' }}>Loading…</p>}

        {items && id && (open ? <Article item={open} /> : (
          <div style={s.centre}>
            <p style={{ color: 'var(--news-soft)' }}>That piece is not available.</p>
            <Link to="/news" style={s.back}>&larr; All the news</Link>
          </div>
        ))}

        {items && !id && items.length === 0 && (
          <div style={{ ...s.centre, padding: '60px 0' }}>
            <p style={{ fontFamily: SERIF, fontSize: 22, color: 'var(--news-ink)', margin: 0 }}>Nothing published yet.</p>
            <p style={{ color: 'var(--news-soft)' }}>New games and features will appear here as they ship.</p>
          </div>
        )}

        {items && !id && items.length > 0 && (
          <>
            <Lead item={items[0]} />
            {items.length > 1 && (
              <div style={s.grid}>
                {items.slice(1).map(i => <Card key={i.id} item={i} />)}
              </div>
            )}
          </>
        )}
      </main>
    </Shell>
  );
}

function Eyebrow({ item }: { item: NewsItem }) {
  return (
    <div style={{ ...s.eyebrow, color: accent(item.game) }}>
      {kindInfo(item.kind).eyebrow}
      {item.game && <span style={{ color: 'var(--news-soft)' }}> &nbsp;&middot;&nbsp; {gameLabel(item.game)}</span>}
    </div>
  );
}

function Lead({ item }: { item: NewsItem }) {
  return (
    <article style={{ ...s.lead, borderTopColor: accent(item.game) }} data-news-item={item.id}>
      <Eyebrow item={item} />
      <h2 style={s.leadTitle}>
        <Link to={`/news/${item.id}`} style={s.titleLink}>{item.title}</Link>
      </h2>
      <p style={s.leadSummary}>{item.summary}</p>
      <div style={s.actions}>
        <Link to={`/news/${item.id}`} style={s.cta(accent(item.game))}>Read more</Link>
        {item.game && <a href={gamePath(item.game)} style={s.ghost}>Play {gameLabel(item.game)} &rarr;</a>}
        <span style={s.date}>{fmt(item.publishedAt)}</span>
      </div>
    </article>
  );
}

function Card({ item }: { item: NewsItem }) {
  return (
    <Link to={`/news/${item.id}`} style={{ ...s.card, borderTopColor: accent(item.game) }} data-news-item={item.id}>
      <Eyebrow item={item} />
      <h3 style={s.cardTitle}>{item.title}</h3>
      <p style={s.cardSummary}>{item.summary}</p>
      <span style={s.date}>{fmt(item.publishedAt)}</span>
    </Link>
  );
}

function Article({ item }: { item: NewsItem }) {
  return (
    <article style={s.article}>
      <Link to="/news" style={s.back}>&larr; All the news</Link>
      <div style={{ height: 4, background: accent(item.game), borderRadius: 2, margin: '22px 0 28px', width: 64 }} />
      <Eyebrow item={item} />
      <h1 style={s.articleTitle}>{item.title}</h1>
      <p style={s.leadSummary}>{item.summary}</p>
      <div style={{ ...s.actions, marginBottom: 12 }}>
        {item.game && <a href={gamePath(item.game)} style={s.cta(accent(item.game))}>Play {gameLabel(item.game)}</a>}
        <span style={s.date}>{fmt(item.publishedAt)}</span>
      </div>
      {item.sections.map((sec, i) => (
        <section key={i} style={s.section}>
          {sec.game && <div style={{ ...s.eyebrow, color: accent(sec.game), marginBottom: 10 }}>{gameLabel(sec.game)}</div>}
          {sec.heading && <h2 style={s.sectionTitle}>{sec.heading}</h2>}
          {paragraphs(sec.body).map((p, k) => <p key={k} style={s.body}>{p}</p>)}
          {sec.game && (
            <a href={gamePath(sec.game)} style={{ ...s.inlineLink, color: accent(sec.game) }}>Play {gameLabel(sec.game)} &rarr;</a>
          )}
        </section>
      ))}
    </article>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--news-paper)' }}>
      <PortalNav variant="header" />
      <div style={{ flex: 1 }}>{children}</div>
      <PortalNav variant="footer" />
    </div>
  );
}

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const s = {
  masthead: { background: 'var(--news-band)', padding: '44px 20px 40px' } as CSSProperties,
  mastInner: { maxWidth: 1040, margin: '0 auto', display: 'flex', gap: 28, alignItems: 'flex-end', flexWrap: 'wrap' } as CSSProperties,
  wordmark: { fontFamily: SERIF, fontSize: 13, letterSpacing: 3, textTransform: 'uppercase', color: 'var(--news-house)', marginBottom: 14 } as CSSProperties,
  mastTitle: { fontFamily: SERIF, fontWeight: 'normal', fontSize: 'clamp(30px, 5vw, 44px)', lineHeight: 1.1, margin: '0 0 10px', color: 'var(--news-band-ink)' } as CSSProperties,
  mastSub: { fontFamily: SANS, fontSize: 16, margin: 0, color: 'var(--news-band-text)' } as CSSProperties,
  optin: { background: 'var(--news-card)', border: '1px solid var(--news-rule)', borderRadius: 10, padding: '16px 18px', maxWidth: 320 } as CSSProperties,
  main: { maxWidth: 1040, margin: '0 auto', padding: '36px 20px 64px', fontFamily: SANS } as CSSProperties,
  centre: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center' } as CSSProperties,
  lead: { background: 'var(--news-card)', border: '1px solid var(--news-rule)', borderTop: '4px solid', borderRadius: 10, padding: 'clamp(24px, 4vw, 44px)', marginBottom: 24 } as CSSProperties,
  leadTitle: { fontFamily: SERIF, fontWeight: 'normal', fontSize: 'clamp(28px, 4vw, 38px)', lineHeight: 1.15, margin: '0 0 14px' } as CSSProperties,
  titleLink: { color: 'var(--news-ink)', textDecoration: 'none' } as CSSProperties,
  leadSummary: { fontSize: 18, lineHeight: 1.55, color: 'var(--news-soft)', margin: '0 0 22px', maxWidth: 720 } as CSSProperties,
  actions: { display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' } as CSSProperties,
  cta: (color: string): CSSProperties => ({
    display: 'inline-block', background: color, color: 'var(--news-on-accent)', border: 'none', borderRadius: 6,
    padding: '11px 20px', fontSize: 14, fontWeight: 600, textDecoration: 'none', cursor: 'pointer', fontFamily: SANS,
  }),
  ghost: { color: 'var(--news-ink)', fontSize: 14, fontWeight: 600, textDecoration: 'none' } as CSSProperties,
  date: { fontSize: 12, color: 'var(--news-soft)', letterSpacing: 0.3 } as CSSProperties,
  eyebrow: { fontSize: 11, fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase', marginBottom: 12 } as CSSProperties,
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 } as CSSProperties,
  card: {
    display: 'flex', flexDirection: 'column', background: 'var(--news-card)', border: '1px solid var(--news-rule)',
    borderTop: '3px solid', borderRadius: 10, padding: '22px 22px 18px', textDecoration: 'none',
  } as CSSProperties,
  cardTitle: { fontFamily: SERIF, fontWeight: 'normal', fontSize: 22, lineHeight: 1.25, margin: '0 0 10px', color: 'var(--news-ink)' } as CSSProperties,
  cardSummary: { fontSize: 14.5, lineHeight: 1.55, color: 'var(--news-soft)', margin: '0 0 16px', flex: 1 } as CSSProperties,
  article: { maxWidth: 680, margin: '0 auto' } as CSSProperties,
  articleTitle: { fontFamily: SERIF, fontWeight: 'normal', fontSize: 'clamp(30px, 5vw, 44px)', lineHeight: 1.12, margin: '0 0 16px', color: 'var(--news-ink)' } as CSSProperties,
  back: { color: 'var(--news-soft)', fontSize: 13, textDecoration: 'none', fontWeight: 600 } as CSSProperties,
  section: { borderTop: '1px solid var(--news-rule)', padding: '30px 0 6px', marginTop: 28 } as CSSProperties,
  sectionTitle: { fontFamily: SERIF, fontWeight: 'normal', fontSize: 25, lineHeight: 1.3, margin: '0 0 14px', color: 'var(--news-ink)' } as CSSProperties,
  body: { fontSize: 17, lineHeight: 1.7, color: 'var(--news-text)', margin: '0 0 18px', whiteSpace: 'pre-line' } as CSSProperties,
  inlineLink: { display: 'inline-block', fontSize: 15, fontWeight: 600, textDecoration: 'none', marginBottom: 8 } as CSSProperties,
};
