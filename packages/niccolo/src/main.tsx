import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Lobby from './pages/Lobby';
import { applyScheme, initialScheme } from './lib/colorScheme';
import { initMotion } from './lib/motion';
import GameRoute from './pages/GameRoute';
import './portal.css';
import './lib/kit.css';
import './styles.css';

// Light or dark is the player's choice, shared across the portal (lib/colorScheme.ts). index.html
// has already set it before first paint; this keeps the two in step if that script was skipped.
applyScheme(initialScheme());
// Animation pace (full, quick, off), shared across the portal like the colour scheme.
initMotion();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Lobby />} />
        {/* The game screen's code is fetched only when a campaign is opened (it carries the 385 KB
            world chart and the chapter content, which the lobby needs none of), alongside the save. */}
        <Route path="/game/:id" element={<GameRoute />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
