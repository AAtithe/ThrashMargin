import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyScheme, initialScheme } from './lib/colorScheme';
import './portal.css';
import './lib/kit.css';
import './styles.css';

// Light or dark is the player's choice, shared across the portal (lib/colorScheme.ts). index.html
// has already set it before first paint; this keeps the two in step if that script was skipped.
applyScheme(initialScheme());

// The app's code is kept on the phone by a service worker (public/sw.js), so a repeat open is quick.
// Production only: in development Vite serves fresh files on every change.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
