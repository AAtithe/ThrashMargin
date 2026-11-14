import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Lobby from './pages/Lobby';
import HowToPlay from './pages/HowToPlay';
import GameScreen from './pages/GameScreen';
import { applyScheme, initialScheme } from './lib/colorScheme';
import { initMotion } from './lib/motion';
// The campaign map's typeface (game/campaignArt.ts): latin only, bundled and served from this origin.
import '@fontsource/old-standard-tt/latin-400.css';
import '@fontsource/old-standard-tt/latin-400-italic.css';
import '@fontsource/old-standard-tt/latin-700.css';
import './portal.css';
import './lib/kit.css';
import './styles.css';

// Light or dark is the player's choice, shared across the portal (lib/colorScheme.ts). index.html
// has already set it before first paint; this keeps the two in step if that script was skipped.
applyScheme(initialScheme());
// The portal's animation pace (full, quick, off), shared by every game (lib/motion.ts).
initMotion();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/how-to-play" element={<HowToPlay />} />
        <Route path="/game/:id" element={<GameScreen />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
