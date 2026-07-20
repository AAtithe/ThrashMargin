import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Lobby from './pages/Lobby';
import GameScreen from './pages/GameScreen';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/game/:id" element={<GameScreen />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
