import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'thrash_margin.sqlite');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS games (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode        TEXT NOT NULL DEFAULT 'single',
    status      TEXT NOT NULL DEFAULT 'active',
    turn        INTEGER NOT NULL DEFAULT 1,
    state       TEXT NOT NULL,
    config      TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT 'Campaign',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS game_actions (
    id          TEXT PRIMARY KEY,
    game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id),
    turn        INTEGER NOT NULL,
    action      TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS player_stats (
    user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    games_played  INTEGER NOT NULL DEFAULT 0,
    games_won     INTEGER NOT NULL DEFAULT 0,
    games_lost    INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_games_owner ON games(owner_id);
  CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
  CREATE INDEX IF NOT EXISTS idx_actions_game ON game_actions(game_id);
`);
