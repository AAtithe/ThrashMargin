const STYLE: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0e0b07',
  color: '#c9b88a',
  fontFamily: '"Georgia", "Times New Roman", serif',
};

const TITLE: React.CSSProperties = {
  fontSize: '2.4rem',
  fontWeight: 400,
  letterSpacing: '0.12em',
  marginBottom: '0.4rem',
  color: '#e8d5a3',
};

const SUBTITLE: React.CSSProperties = {
  fontSize: '0.95rem',
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  marginBottom: '2.5rem',
};

const RULE: React.CSSProperties = {
  width: '160px',
  border: 'none',
  borderTop: '1px solid #4a3d28',
  marginBottom: '2.5rem',
};

const PHASE: React.CSSProperties = {
  fontSize: '0.78rem',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: '#5a4f3a',
};

export default function App() {
  return (
    <div style={STYLE}>
      <h1 style={TITLE}>Banco di Niccolo</h1>
      <p style={SUBTITLE}>House of Niccolo · 1460 – 1483</p>
      <hr style={RULE} />
      <p style={PHASE}>Phase 0 scaffold — building begins</p>
    </div>
  );
}
