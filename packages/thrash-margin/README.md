# Thrash Margin

> Every border is a balance sheet.

A turn-based territory strategy game on the portal: take land, feed the army, out-earn your rivals.
Settlers-style economy against Risk-style conquest, deterministic combat, up to three AI rivals or a
second player in hot seat.

- **Play:** `/thrash-margin/` on the portal. A signed-in account is required.
- **Rules and build log:** `thrash-margin-design.md` at the repo root.
- **Working notes for contributors:** `CLAUDE.md` in this folder.

## Stack

React + Vite + TypeScript client, Vercel functions for the API, the portal's shared Postgres
`games` table, JWT auth. The engine (`shared/sim/`) is pure TypeScript and runs in the browser;
the server creates games and stores state.

## Develop

```bash
npm install                              # repo root
npm run drive:tm                         # repo root: rules harness, a few seconds
cd packages/thrash-margin/client && npm install && npm run dev   # http://localhost:5173
```

To see the UI without the API, set the stored user in the browser console (client-side only; it
grants no server access and cloud saves will 401, so the game falls back to browser saves):

```js
localStorage.setItem('tm_user', JSON.stringify({ userId: 'local-dev', username: 'local-dev' }))
```

## Deploy

Built as part of the portal by `scripts/build-portal.sh`; see `DEPLOY.md`.
