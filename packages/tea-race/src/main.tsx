import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Lobby from './pages/Lobby';
import Tutorial from './pages/Tutorial';
import GameScreen from './pages/GameScreen';
import { applyScheme, initialScheme } from './lib/colorScheme';
import './portal.css';
import './styles.css';

// Light or dark is the player's choice, shared across the portal (lib/colorScheme.ts). index.html
// has already set it before first paint; this keeps the two in step if that script was skipped.
applyScheme(initialScheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/how-to-play" element={<Tutorial />} />
        <Route path="/game/:id" element={<GameScreen />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
