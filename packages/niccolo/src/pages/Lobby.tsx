import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { getStoredUser } from '../lib/portalAuth';
import PortalNav from '../components/PortalNav';
import type { SaveMeta } from '../hooks/useGameLocal';

const STYLE: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: '#0e0b07',
  color: '#c9b88a',
  fontFamily: '"Georgia", "Times New Roman", serif',
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
  fontSize: '2rem',
  letterSpacing: '0.1em',
  color: '#e8d5a3',
  margin: '0 0 0.2rem',
};

const SUBTITLE: React.CSSProperties = {
  color: '#8a7a5a',
  fontSize: '0.85rem',
  margin: '0 0 2rem',
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0 0 0.6rem',
};

const CARD: React.CSSProperties = {
  border: '1px solid #4a3d28',
  background: '#161009',
  padding: '0.8rem 1rem',
  marginBottom: '0.6rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.8rem',
};

const BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  padding: '0.5rem 0.9rem',
  fontFamily: 'inherit',
  fontSize: '0.85rem',
  letterSpacing: '0.05em',
  cursor: 'pointer',
};

const FIELD: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  fontFamily: 'inherit',
  fontSize: '0.85rem',
  padding: '0.5rem 0.7rem',
  flex: 1,
};

function statusBadge(status: SaveMeta['status']): { text: string; color: string } {
  if (status === 'victory') return { text: 'Partnership converted', color: '#3a6b5a' };
  if (status === 'defeated') return { text: 'Insolvent', color: '#b5451a' };
  return { text: 'In progress', color: '#a08040' };
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
  const { saves, createGame, deleteGame } = useGameHybrid();
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

  const active = saves.filter(s => s.status === 'active');
  const finished = saves.filter(s => s.status !== 'active');

  return (
    <div style={STYLE}>
      <PortalNav variant="header" />
      <div style={CONTENT}>
        <h1 style={TITLE}>Banco di Niccolo</h1>
        <p style={SUBTITLE}>Trading, banking and intelligence in the House of Niccolo — Chapter 1: Niccolo Rising.</p>

        <p style={SECTION_LABEL}>Begin a new campaign</p>
        <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '2rem' }}>
          <input
            style={FIELD}
            placeholder={`Campaign #${saves.length + 1}`}
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={40}
          />
          <button style={BUTTON} onClick={handleNew} disabled={starting}>
            {starting ? '…' : 'Begin →'}
          </button>
        </div>

        <p style={SECTION_LABEL}>Active campaigns</p>
        {active.length === 0 && (
          <p style={{ color: '#6a5a40', fontSize: '0.85rem' }}>No active campaigns — start one above.</p>
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
      <div style={{ padding: '0.8rem 1.5rem', borderTop: '1px solid #2a2117', fontSize: '0.75rem', color: '#6a5a40' }}>
        {saves.length} campaign{saves.length === 1 ? '' : 's'} saved {user ? 'in cloud' : 'locally'}
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#e8d5a3', fontSize: '0.9rem' }}>{save.name}</div>
        <div style={{ fontSize: '0.72rem', color: '#8a7a5a' }}>
          Week {save.turn} · <span style={{ color: badge.color }}>{badge.text}</span> · {relTime(save.savedAt)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
        {isConfirming ? (
          <>
            <span style={{ color: '#b5451a', fontSize: '0.75rem', alignSelf: 'center' }}>Delete?</span>
            <button style={BUTTON} onClick={onDelete}>Yes</button>
            <button style={BUTTON} onClick={() => setConfirmDelete(null)}>No</button>
          </>
        ) : (
          <>
            <button style={BUTTON} onClick={onContinue}>{save.status === 'active' ? 'Continue →' : 'View'}</button>
            <button style={BUTTON} onClick={() => setConfirmDelete(save.id)}>🗑</button>
          </>
        )}
      </div>
    </div>
  );
}
