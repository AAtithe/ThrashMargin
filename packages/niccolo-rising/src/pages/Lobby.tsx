import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FONT, UI } from '../theme';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { getStoredUser } from '../lib/portalAuth';
import PortalNav from '../components/PortalNav';
import type { SaveMeta } from '../hooks/useGameLocal';

const PAGE: React.CSSProperties = { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: UI.ground, color: UI.text, fontFamily: FONT.body };
const CONTENT: React.CSSProperties = { maxWidth: 640, margin: '0 auto', padding: '2rem 1.5rem', flex: 1, width: '100%', boxSizing: 'border-box' };
const TITLE: React.CSSProperties = { fontFamily: FONT.display, fontSize: '2rem', letterSpacing: '0.08em', color: UI.brass, margin: '0 0 0.2rem', fontWeight: 'normal' };
const LABEL: React.CSSProperties = { fontSize: '0.75rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: UI.textSoft, margin: '0 0 0.6rem' };
const CARD: React.CSSProperties = { border: `1px solid ${UI.rule}`, background: UI.panelRaised, padding: '0.8rem 1rem', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.8rem' };
const BUTTON: React.CSSProperties = { background: UI.panel, border: `1px solid ${UI.rule}`, color: UI.text, padding: '0.5rem 0.9rem', fontFamily: 'inherit', fontSize: '0.85rem', cursor: 'pointer' };
const FIELD: React.CSSProperties = { background: UI.panel, border: `1px solid ${UI.rule}`, color: UI.text, fontFamily: 'inherit', fontSize: '0.85rem', padding: '0.5rem 0.7rem', flex: 1 };

function relTime(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Lobby() {
  const { saves, error, createGame, deleteGame } = useGameHybrid();
  const nav = useNavigate();
  const user = getStoredUser();
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const handleNew = async () => {
    setStarting(true);
    const id = await Promise.resolve(createGame(name.trim() || undefined));
    setStarting(false);
    if (id) nav(`/game/${id}`);
  };

  /**
   * Every game on the portal requires a real account. **There is no guest path, and none is to be
   * added back**: one existed and was deliberately removed. See CLAUDE.md at the repo root.
   *
   * This check is presentational: it reads `tm_user` from localStorage and decides what to render,
   * so it protects nothing on its own. It still has to stay, because it is what stops the app
   * inviting somebody to start a character they cannot save.
   *
   * The real boundary is server-side, in `api/_lib/auth.ts`: `getUser(req)` requires a Bearer JWT
   * verified against JWT_SECRET, and the game endpoint 401s without one. Do not relax either half to
   * make local work easier; to check the UI, set `tm_user` in the browser console instead.
   */
  if (!user) {
    return (
      <div style={PAGE}>
        <PortalNav variant="header" />
        <div style={{ ...CONTENT, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div style={{ ...CARD, flexDirection: 'column', alignItems: 'stretch', maxWidth: 360, padding: '2rem 2.2rem' }}>
            <h1 style={{ ...TITLE, textAlign: 'center' }}>Niccolò Rising</h1>
            <p style={{ color: UI.textSoft, fontSize: '0.85rem', textAlign: 'center', margin: '0 0 1.6rem' }}>
              Sign in to keep your character on your account.
            </p>
            <button
              style={{ ...BUTTON, background: UI.panelRaised, borderColor: UI.brass, color: UI.brass }}
              onClick={() => { window.location.href = '/thrash-margin/login?next=/rising/'; }}
            >
              Sign in / Register →
            </button>
          </div>
        </div>
        <PortalNav variant="footer" />
      </div>
    );
  }

  return (
    <div style={PAGE}>
      <PortalNav variant="header" />
      <div style={CONTENT}>
        <h1 style={TITLE}>Niccolò Rising</h1>
        <p style={{ color: UI.textSoft, fontSize: '0.85rem', margin: '0 0 0.6rem' }}>
          Bruges, 1460. A dyer's lad with a loft to sleep in and a reputation for jokes.
        </p>
        <p style={{ color: UI.textFaint, fontSize: '0.78rem', lineHeight: 1.5, margin: '0 0 2rem' }}>
          A real-time game in the shape of Torn. Energy, Nerve, Spirits and Health refill by the clock
          while you are away; courses, journeys and spells in the Steen take real hours. Train in the
          yards, run schemes, work for the Charetty or the Medici, trade alum and silk from abroad, and
          one day put Simon de St Pol on his back.
        </p>

        {error && (
          <p style={{ fontSize: '0.8rem', color: UI.bad, border: `1px solid ${UI.bad}`, padding: '0.6rem 0.8rem', margin: '0 0 1.2rem' }}>{error}</p>
        )}

        <p style={LABEL}>A new character</p>
        <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '2rem' }}>
          <input style={FIELD} placeholder="Claes" value={name} onChange={e => setName(e.target.value)} maxLength={40} />
          <button style={BUTTON} onClick={handleNew} disabled={starting}>
            {starting ? '…' : 'Begin →'}
          </button>
        </div>

        <p style={LABEL}>Your characters</p>
        {saves.length === 0 && <p style={{ color: UI.textFaint, fontSize: '0.85rem' }}>None yet. Begin one above.</p>}
        {saves.map(save => (
          <SaveCard
            key={save.id}
            save={save}
            confirming={confirmDelete === save.id}
            onConfirm={() => setConfirmDelete(save.id)}
            onCancel={() => setConfirmDelete(null)}
            onContinue={() => nav(`/game/${save.id}`)}
            onDelete={() => { deleteGame(save.id); setConfirmDelete(null); }}
          />
        ))}
      </div>
      <PortalNav variant="footer" />
    </div>
  );
}

function SaveCard({ save, confirming, onConfirm, onCancel, onContinue, onDelete }: {
  save: SaveMeta;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onContinue: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={CARD}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: UI.brass, fontSize: '0.9rem' }}>{save.name}</div>
        <div style={{ fontSize: '0.72rem', color: UI.textSoft }}>Level {save.turn} · {relTime(save.savedAt)}</div>
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
        {confirming ? (
          <>
            <span style={{ color: UI.bad, fontSize: '0.75rem', alignSelf: 'center' }}>Delete for good?</span>
            <button style={BUTTON} onClick={onDelete}>Yes</button>
            <button style={BUTTON} onClick={onCancel}>No</button>
          </>
        ) : (
          <>
            <button style={BUTTON} onClick={onContinue}>Continue →</button>
            <button style={BUTTON} onClick={onConfirm}>Delete</button>
          </>
        )}
      </div>
    </div>
  );
}
