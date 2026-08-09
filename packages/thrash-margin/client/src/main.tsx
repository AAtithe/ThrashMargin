import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Game from './pages/Game';
import Lobby from './pages/Lobby';
import Login from './pages/Login';
import Feedback from './pages/Feedback';
import Profile from './pages/Profile';
import Admin from './pages/Admin';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/"         element={<Lobby />} />
        <Route path="/login"    element={<Login />} />
        <Route path="/game/:id" element={<Game />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/profile"  element={<Profile />} />
        {/* No nav link anywhere — admin access is gated server-side by username, not by
            hiding this route. Reaching the page means nothing without a valid admin session. */}
        <Route path="/admin"    element={<Admin />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
