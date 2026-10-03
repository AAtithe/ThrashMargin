import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Lobby from './pages/Lobby';
// Loaded only when a campaign is opened. The game screen carries the 385 KB world chart and the
// chapter content; the lobby needs none of it, so the first visit downloads far less.
const GameScreen = lazy(() => import('./pages/GameScreen'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route
          path="/game/:id"
          element={
            <Suspense fallback={<div style={{ padding: 32, color: '#9a8a6a', fontFamily: 'Georgia, serif' }}>Opening the ledger…</div>}>
              <GameScreen />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
