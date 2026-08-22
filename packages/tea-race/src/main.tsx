import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Lobby from './pages/Lobby';
import Tutorial from './pages/Tutorial';
import GameScreen from './pages/GameScreen';
import { UI } from './theme';
import './styles.css';

// The game commits to one dark, warm palette rather than following the OS theme — it is a chart
// room, not a document. Setting it on the document root keeps the browser's own scrollbars and
// form controls in step with it.
document.documentElement.style.colorScheme = 'dark';
document.body.style.margin = '0';
document.body.style.background = UI.ground;

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
