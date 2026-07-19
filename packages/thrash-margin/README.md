# Thrash Margin

> Build fast. Fight harder. Hold the margin.

A territory strategy game combining settlement development with military conquest. Every border is a balance sheet.

## Stack

- **Frontend**: React + Vite + TypeScript
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL (via `pg`)
- **Auth**: JWT + bcrypt
- **Deploy**: Railway (backend + db) / Vercel (frontend)

## Project structure

```
thrash-margin/
├── client/          # React/Vite frontend
│   └── src/
│       ├── components/   # UI components
│       ├── game/         # Game rendering (canvas)
│       ├── hooks/        # React hooks
│       └── pages/        # Route pages
├── server/          # Express backend
│   └── src/
│       ├── db/           # Database client + migrations
│       ├── engine/       # Game logic (pure TypeScript)
│       ├── middleware/    # Auth, error handling
│       └── routes/       # API route handlers
├── shared/          # Types shared between client and server
└── docker-compose.yml
```

## Getting started locally

### Prerequisites
- Node.js 18+
- Docker (for local Postgres) or a Postgres instance

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/thrash-margin.git
cd thrash-margin
npm install
cd client && npm install
cd ../server && npm install
```

### 2. Start local database

```bash
docker-compose up -d
```

### 3. Set up environment variables

```bash
cp server/.env.example server/.env
# Edit server/.env with your values
```

### 4. Run migrations

```bash
cd server
npm run migrate
```

### 5. Start dev servers

```bash
# From root — runs both client and server
npm run dev
```

Client runs on http://localhost:5173  
Server runs on http://localhost:3001

## Claude Code instructions

When opening this project in Claude Code, say:

> "This is Thrash Margin, a territory strategy game. The game engine lives in server/src/engine/. The client sends action payloads to the REST API at /api/game/:id/action and renders the returned game state. Continue building from CLAUDE.md."

## Deployment

See `DEPLOY.md` for Railway + Vercel deployment instructions.
