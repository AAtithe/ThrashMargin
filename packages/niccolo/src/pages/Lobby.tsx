import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UI, FONT } from '../theme';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { getStoredUser, hasGameAccess } from '../lib/portalAuth';
import NoGameAccess from '../lib/NoGameAccess';
import { HOUSES } from '../sim/content';
import { FREEPLAY_DEADLINE_WEEKS, FREEPLAY_START_CASH, FREEPLAY_TARGET_NET_WORTH } from '../sim/freeplay';
import type { FreeplayGoal, RivalCount } from '../sim/freeplay';
import PortalNav from '../components/PortalNav';
import TutorialOverlay from '../components/TutorialOverlay';
import type { SaveMeta } from '../hooks/useGameLocal';
import { BusyLabel, LoadingRows } from '../lib/Loading';

const STYLE: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: UI.ground,
  color: UI.text,
  fontFamily: FONT.body,
};

const CONTENT: React.CSSProperties = {
  maxWidth: '640px',
  margin: '0 auto',
  padding: '2rem 1.5rem',
  flex: 1,
  width: '100%',
  boxSizing: 'border-box',
};

const TITLE: React.CSSProperties = {
  fontSize: 'clamp(1.5rem, 6vw, 2rem)',
  letterSpacing: '0.1em',
  color: UI.brass,
  margin: '0 0 0.2rem',
};

const SUBTITLE: React.CSSProperties = {
  color: UI.textSoft,
  fontSize: '0.85rem',
  margin: '0 0 2rem',
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: UI.textSoft,
  margin: '0 0 0.6rem',
};

const CARD: React.CSSProperties = {
  border: `1px solid ${UI.rule}`,
  background: UI.panelRaised,
  padding: '0.8rem 1rem',
  marginBottom: '0.6rem',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.8rem',
};

/** 40px tall at the least, so every lobby control is a comfortable tap on a phone. */
const BUTTON: React.CSSProperties = {
  background: UI.panel,
  border: `1px solid ${UI.ruleStrong}`,
  color: UI.text,
  padding: '0.5rem 0.9rem',
  minHeight: 40,
  fontFamily: 'inherit',
  fontSize: '0.85rem',
  letterSpacing: '0.05em',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/** The lobby's one call to action, in the accent: the same look as the game's Advance one week. */
const PRIMARY_BUTTON: React.CSSProperties = {
  ...BUTTON,
  border: `1px solid ${UI.brass}`,
  color: UI.brass,
  background: UI.tintBrass,
};

const FIELD: React.CSSProperties = {
  background: UI.panel,
  border: `1px solid ${UI.ruleStrong}`,
  color: UI.text,
  fontFamily: 'inherit',
  fontSize: '0.85rem',
  padding: '0.5rem 0.7rem',
  minHeight: 40,
  boxSizing: 'border-box',
  flex: 1,
  minWidth: 0,
};

/** A select inside a settings line: as wide as its longest option, but never wider than the column. */
const SELECT: React.CSSProperties = {
  ...FIELD,
  flex: '0 1 auto',
  width: 'auto',
  maxWidth: '100%',
  minHeight: 36,
  fontSize: '0.75rem',
  padding: '0.3rem 0.5rem',
};

/** A settings line holding a select: wraps under its label on a narrow screen rather than overflow. */
const SELECT_ROW: React.CSSProperties = {
  fontSize: '0.75rem',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.4rem',
  alignItems: 'center',
};

function statusBadge(status: SaveMeta['status']): { text: string; color: string } {
  if (status === 'victory') return { text: 'Partnership converted', color: UI.good };
  if (status === 'defeated') return { text: 'Insolvent', color: UI.bad };
  return { text: 'In progress', color: UI.warn };
}

function relTime(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Lobby() {
  const { saves, savesLoaded, error, createGame, deleteGame } = useGameHybrid();
  const nav = useNavigate();
  const user = getStoredUser();
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [skipPrologue, setSkipPrologue] = useState(false);
  const [hideObjectives, setHideObjectives] = useState(false);
  const [hotseatHouseId, setHotseatHouseId] = useState('');
  const [freeplay, setFreeplay] = useState(false);
  const [rivals, setRivals] = useState<RivalCount>(2);
  const [goal, setGoal] = useState<FreeplayGoal>('target');

  const handleNew = async () => {
    setStarting(true);
    const id = await Promise.resolve(
      createGame(name.trim() || undefined, skipPrologue, hideObjectives, hotseatHouseId || null, freeplay, rivals, goal),
    );
    setStarting(false);
    if (id) nav(`/game/${id}`);
  };

  const active = saves.filter(s => s.status === 'active');
  const finished = saves.filter(s => s.status !== 'active');

  /**
   * Every game on the portal requires a real account. **There is no guest path, and none is to be
   * added back** — one existed and was deliberately removed. See CLAUDE.md at the repo root.
   *
   * This check is presentational: it reads `tm_user` from localStorage and decides what to render, so
   * it is trivially satisfied client-side and protects nothing on its own. It still has to stay — it
   * is what stops the app inviting somebody to start a game they cannot save.
   *
   * The real boundary is server-side, in `api/_lib/auth.ts`: `getUser(req)` requires a Bearer JWT
   * verified against JWT_SECRET, and every game endpoint 401s without one. Do not relax either half
   * to make local work easier — to check the UI, set `tm_user` in the browser console instead.
   */
  if (!user) {
    return (
      <div style={STYLE}>
        <PortalNav variant="header" />
        <div style={{ ...CONTENT, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div style={{ ...CARD, flexDirection: 'column', alignItems: 'stretch', maxWidth: 360, padding: '2rem 2.2rem' }}>
            <h1 style={{ ...TITLE, textAlign: 'center' }}>Banco di Niccolo</h1>
            <p style={{ ...SUBTITLE, textAlign: 'center', margin: '0 0 1.6rem' }}>
              Sign in to keep your campaigns on your account.
            </p>
            <button
              style={{ ...BUTTON, background: UI.panelRaised, borderColor: UI.brass, color: UI.brass, marginBottom: '0.6rem' }}
              onClick={() => { window.location.href = '/thrash-margin/login?next=/niccolo/'; }}
            >
              Sign in / Register →
            </button>
          </div>
        </div>
        <PortalNav variant="footer" />
      </div>
    );
  }

  // Game access, set per account on the Admin page. Presentational, like the check above: the server
  // refuses every request to a game the account does not have (api/play/[kind].ts).
  if (!hasGameAccess(user, 'niccolo')) {
    return <NoGameAccess title="Banco di Niccolò" header={<PortalNav variant="header" />} footer={<PortalNav variant="footer" />} />;
  }

  return (
    <div style={STYLE}>
      {showTutorial && <TutorialOverlay onClose={() => setShowTutorial(false)} />}
      <PortalNav variant="header" />
      <div style={CONTENT}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem 1rem', marginBottom: '0.5rem' }}>
          <h1 style={{ ...TITLE, margin: 0 }}>Banco di Niccolò</h1>
          <button style={BUTTON} onClick={() => setShowTutorial(true)}>
            How to play
          </button>
        </div>
        <p style={SUBTITLE}>
          Trading, banking and intelligence in the House of Niccolò. Chapter 0: Claes begins.
        </p>

        {error && (
          <p style={{ fontSize: '0.8rem', color: UI.bad, border: `1px solid ${UI.badRule}`, background: UI.tintBad, padding: '0.6rem 0.8rem', margin: '0 0 1.2rem' }}>
            {error}
          </p>
        )}

        <p style={SECTION_LABEL}>{freeplay ? 'Begin a free-play game' : 'Begin a new campaign'}</p>
        <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.6rem' }}>
          <input
            style={FIELD}
            placeholder={`Campaign #${saves.length + 1}`}
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={40}
          />
          <button style={{ ...PRIMARY_BUTTON, ...(starting ? { opacity: 0.6 } : {}) }} onClick={handleNew} disabled={starting}>
            {starting ? <BusyLabel>Opening…</BusyLabel> : 'Begin →'}
          </button>
        </div>
        <label style={{ fontSize: '0.75rem', color: UI.textSoft, display: 'flex', gap: '0.4rem', alignItems: 'flex-start', minHeight: 40, marginBottom: '0.6rem' }}>
          <input type="checkbox" checked={freeplay} onChange={e => setFreeplay(e.target.checked)} />
          <span>
            <strong style={{ color: UI.brass, fontWeight: 'normal' }}>Free play instead of the story</strong>: the
            whole map open from the first week, {FREEPLAY_START_CASH}f, and rival houses trading against you for real.
            No chapters and no scripted events, just the market, and somebody else in it.
          </span>
        </label>

        {freeplay && (
          <label style={{ ...SELECT_ROW, color: UI.textSoft, marginBottom: '0.8rem', paddingLeft: '1.4rem' }}>
            <span style={{ whiteSpace: 'nowrap' }}>Rivals:</span>
            <select
              style={SELECT}
              value={rivals}
              onChange={e => setRivals(Number(e.target.value) as RivalCount)}
            >
              <option value={0}>None: trade the map on your own</option>
              <option value={1}>One: the Grimani of Venice</option>
              <option value={2}>Two: Venice and the Doria consortium</option>
              <option value={3}>Three: add the Hanse factory at London</option>
            </select>
          </label>
        )}

        {freeplay && (
          <label style={{ ...SELECT_ROW, color: UI.textSoft, marginBottom: '0.8rem', paddingLeft: '1.4rem' }}>
            <span style={{ whiteSpace: 'nowrap' }}>Winning means:</span>
            <select
              style={SELECT}
              value={goal}
              onChange={e => setGoal(e.target.value as FreeplayGoal)}
            >
              <option value="target">
                First house past {FREEPLAY_TARGET_NET_WORTH.toLocaleString()}f: a race, and you can see who is winning
              </option>
              <option value="by_year">
                Richest in week {FREEPLAY_DEADLINE_WEEKS}: five years, and nobody knows until the end
              </option>
              <option value="survivor">
                Last house solvent: the trade you decline matters more than the one you take
              </option>
            </select>
          </label>
        )}

        {/* The three below are campaign settings and mean nothing in free play, which has no
            prologue, no chapter objectives and no scripted houses to hand a friend. Disabled rather
            than hidden, so the mode's cost is visible rather than a silent disappearance. */}
        {freeplay && (
          <p style={{ fontSize: '0.75rem', color: UI.textSoft, margin: '0 0 0.4rem' }}>
            The story settings below are off: free play has no prologue, objectives or rival house to hand over.
          </p>
        )}
        <label style={{ fontSize: '0.75rem', color: freeplay ? UI.textFaint : UI.textSoft, display: 'flex', gap: '0.4rem', alignItems: 'flex-start', minHeight: 40, marginBottom: '0.6rem' }}>
          <input type="checkbox" disabled={freeplay} checked={!freeplay && skipPrologue} onChange={e => setSkipPrologue(e.target.checked)} />
          <span>
            Skip the prologue: start straight in as a merchant with a ship, a courier, and 40f,
            rather than as Claes the dyeworks apprentice with nothing yet.
          </span>
        </label>

        <label style={{ fontSize: '0.75rem', color: freeplay ? UI.textFaint : UI.textSoft, display: 'flex', gap: '0.4rem', alignItems: 'flex-start', minHeight: 40, marginBottom: '0.6rem' }}>
          <input type="checkbox" disabled={freeplay} checked={!freeplay && hideObjectives} onChange={e => setHideObjectives(e.target.checked)} />
          <span>
            Hide chapter objectives: track your own progress without a checklist naming which
            story threads still need resolving.
          </span>
        </label>

        <label style={{ ...SELECT_ROW, color: freeplay ? UI.textFaint : UI.textSoft, marginBottom: '2rem' }}>
          <span>Let a friend run a rival house this campaign:</span>
          <select
            disabled={freeplay}
            style={{ ...SELECT, ...(freeplay ? { opacity: 0.6 } : {}) }}
            value={freeplay ? '' : hotseatHouseId}
            onChange={e => setHotseatHouseId(e.target.value)}
          >
            <option value="">No one: every house stays on its own formula</option>
            {HOUSES.map(h => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </label>

        <p style={SECTION_LABEL}>Active campaigns</p>
        {!savesLoaded && <LoadingRows rows={2} label="Loading your campaigns" />}
        {savesLoaded && active.length === 0 && (
          <p style={{ color: UI.textFaint, fontSize: '0.85rem', border: `1px dashed ${UI.rule}`, padding: '0.9rem 1rem', margin: 0 }}>
            No active campaigns yet. Name one above and press Begin.
          </p>
        )}
        {active.map(save => (
          <SaveCard
            key={save.id}
            save={save}
            confirmDelete={confirmDelete}
            setConfirmDelete={setConfirmDelete}
            onContinue={() => nav(`/game/${save.id}`)}
            onDelete={() => { deleteGame(save.id); setConfirmDelete(null); }}
          />
        ))}

        {finished.length > 0 && (
          <>
            <p style={{ ...SECTION_LABEL, marginTop: '1.5rem' }}>History</p>
            {finished.map(save => (
              <SaveCard
                key={save.id}
                save={save}
                confirmDelete={confirmDelete}
                setConfirmDelete={setConfirmDelete}
                onContinue={() => nav(`/game/${save.id}`)}
                onDelete={() => { deleteGame(save.id); setConfirmDelete(null); }}
              />
            ))}
          </>
        )}
      </div>
      <div style={{ padding: '0.8rem 1.5rem', borderTop: `1px solid ${UI.rule}`, fontSize: '0.75rem', color: UI.textFaint }}>
        {saves.length} campaign{saves.length === 1 ? '' : 's'} saved in cloud
      </div>
      <PortalNav variant="footer" />
    </div>
  );
}

function SaveCard({ save, confirmDelete, setConfirmDelete, onContinue, onDelete }: {
  save: SaveMeta;
  confirmDelete: string | null;
  setConfirmDelete: (id: string | null) => void;
  onContinue: () => void;
  onDelete: () => void;
}) {
  const badge = statusBadge(save.status);
  const isConfirming = confirmDelete === save.id;
  return (
    <div style={CARD}>
      <div style={{ flex: '1 1 10rem', minWidth: 0 }}>
        <div style={{ color: UI.brass, fontSize: '0.95rem', overflowWrap: 'anywhere' }}>{save.name}</div>
        <div style={{ fontSize: '0.75rem', color: UI.textSoft, marginTop: '0.15rem' }}>
          Week {save.turn} · <span style={{ color: badge.color }}>{badge.text}</span> · {relTime(save.savedAt)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, marginLeft: 'auto' }}>
        {isConfirming ? (
          <>
            <span style={{ color: UI.bad, fontSize: '0.75rem', alignSelf: 'center' }}>Delete?</span>
            <button style={{ ...BUTTON, border: `1px solid ${UI.bad}`, color: UI.bad }} onClick={onDelete}>Yes</button>
            <button style={BUTTON} onClick={() => setConfirmDelete(null)}>No</button>
          </>
        ) : (
          <>
            <button style={BUTTON} onClick={onContinue}>{save.status === 'active' ? 'Continue →' : 'View'}</button>
            <button
              style={{ ...BUTTON, color: UI.textSoft }}
              onClick={() => setConfirmDelete(save.id)}
              aria-label={`Delete ${save.name}`}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
