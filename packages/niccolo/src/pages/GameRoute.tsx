import { useEffect, useState, type ComponentType } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGameHybrid } from '../hooks/useGameHybrid';
import { SESSION_EXPIRED } from '../hooks/useGameCloud';
import { clearToken } from '../lib/portalAuth';
import CampaignLoading from '../components/CampaignLoading';
import type { GameScreenProps } from './GameScreen';

/**
 * The /game/:id route. A campaign needs two things before it can open: the game screen's code
 * chunk (the 385 KB world chart and the chapter content, which the lobby never downloads) and the
 * save. Both are fetched here, at once, and one loader stands for both until both are in.
 *
 * This used to be a Suspense boundary around a lazy GameScreen that fetched its own save: the chunk
 * first, then the save, each stage with its own loader. Two loaders meant the second had to work
 * out that it was taking over from the first (the shared loader's handover rule), and the save
 * request could not start until the chunk had arrived. One loader, mounted once, has no handover
 * to get wrong, and the two downloads overlap.
 */
type Screen = ComponentType<GameScreenProps>;

const loadScreen = () => import('./GameScreen');

export default function GameRoute() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const game = useGameHybrid();
  const [screen, setScreen] = useState<Screen | null>(null);
  const [chunkFailed, setChunkFailed] = useState(false);

  const fetchScreen = () => {
    setChunkFailed(false);
    loadScreen().then(
      m => setScreen(() => m.default),
      () => setChunkFailed(true),
    );
  };

  useEffect(fetchScreen, []);

  useEffect(() => {
    if (id) game.loadGame(id);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const GameScreen = screen;
  if (GameScreen && game.state) return <GameScreen game={game} />;

  const error = game.error ?? (chunkFailed ? 'The game could not be downloaded. Check the connection and try again.' : null);
  return (
    <CampaignLoading
      error={error}
      onRetry={() => {
        if (chunkFailed) fetchScreen();
        if (id && !game.state) void game.loadGame(id);
      }}
      onBack={() => nav('/')}
      onSignIn={game.error === SESSION_EXPIRED ? () => { clearToken(); nav('/'); } : undefined}
    />
  );
}
