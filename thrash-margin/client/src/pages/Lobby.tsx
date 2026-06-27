// client/src/pages/Lobby.tsx
// Claude Code: list player's games, create new game, show leaderboard

import { useNavigate } from 'react-router-dom';
import { useGame } from '../hooks/useGame';

export default function Lobby() {
  const { createGame } = useGame();
  const nav = useNavigate();

  const handleNew = async () => {
    const id = await createGame();
    if (id) nav(`/game/${id}`);
  };

  return (
    <div>
      <h1>Thrash Margin</h1>
      <button onClick={handleNew}>New game</button>
      <p>Lobby stub — Claude Code: add game list, settings, leaderboard</p>
    </div>
  );
}
