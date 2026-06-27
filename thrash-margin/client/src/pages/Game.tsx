// client/src/pages/Game.tsx
// Claude Code: wire up GameCanvas + sidebar + action controls to useGame hook

import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useGame } from '../hooks/useGame';

export default function Game() {
  const { id } = useParams<{ id: string }>();
  const { state, loading, loadGame, sendAction } = useGame();

  useEffect(() => {
    if (id) loadGame(id);
  }, [id, loadGame]);

  if (loading) return <div>Loading...</div>;
  if (!state)  return <div>Game not found.</div>;

  // Claude Code: replace this with GameCanvas + sidebar layout
  // GameCanvas takes state and onNodeClick, onEdgeClick
  // Sidebar shows selected territory, building panel, attack preview, log
  // Action bar shows recruit slider, attack slider, end turn

  return (
    <div>
      <pre style={{ fontSize: 11 }}>{JSON.stringify(state, null, 2)}</pre>
    </div>
  );
}
