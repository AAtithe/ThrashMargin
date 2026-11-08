import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Lobby from './pages/Lobby';
import { applyScheme, initialScheme } from './lib/colorScheme';
import { initMotion } from './lib/motion';
import CampaignLoading from './components/CampaignLoading';
import './portal.css';
import './styles.css';
// Loaded only when a campaign is opened. The game screen carries the 385 KB world chart and the
// chapter content; the lobby needs none of it, so the first visit downloads far less.
const GameScreen = lazy(() => import('./pages/GameScreen'));

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
        <Route
          path="/game/:id"
          element={
            <Suspense fallback={<CampaignLoading />}>
              <GameScreen />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
