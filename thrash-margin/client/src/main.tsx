import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Game from './pages/Game';
import Login from './pages/Login';
import Lobby from './pages/Lobby';

// Claude Code: add global styles, auth context, protected routes

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/"         element={<Lobby />} />
        <Route path="/login"    element={<Login />} />
        <Route path="/game/:id" element={<Game />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
