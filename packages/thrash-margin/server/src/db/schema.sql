-- server/src/db/schema.sql
-- Thrash Margin database schema
-- Run via: psql $DATABASE_URL -f schema.sql
-- Or: npm run migrate (from server/)

-- Users
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username       VARCHAR(32) UNIQUE NOT NULL,
  email          VARCHAR(255) UNIQUE NOT NULL,
  password       VARCHAR(255) NOT NULL,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent migration for the already-deployed instance — see the `games.game` migration
-- below for why this pattern is used instead of a separate numbered migration file.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Games
-- `game` discriminates which app owns this row so Thrash Margin, Banco di Niccolo, The Tea Race
-- (and any future game) can share one users/games/auth infrastructure instead of standing up a
-- second database. Existing rows predate this column and default to 'thrash_margin', so no
-- backfill is needed. There is deliberately no CHECK constraint on the value: adding a game means
-- adding a string, not running a migration. Keep new values within VARCHAR(16).
CREATE TABLE IF NOT EXISTS games (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game        VARCHAR(16) NOT NULL DEFAULT 'thrash_margin',  -- 'thrash_margin' | 'niccolo' | 'tea_race'
  mode        VARCHAR(16) NOT NULL DEFAULT 'single',  -- 'single' | 'pvp'
  status      VARCHAR(16) NOT NULL DEFAULT 'active',  -- 'active' | 'victory' | 'defeated'
  turn        INTEGER NOT NULL DEFAULT 1,
  state       JSONB NOT NULL,                          -- full GameState blob
  config      JSONB NOT NULL,                          -- GameConfig snapshot
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent migration for a database created before the `game` column existed (e.g. the
-- already-deployed Supabase instance) — running this file again against a fresh install is a
-- harmless no-op since the column is already in the CREATE TABLE above.
ALTER TABLE games ADD COLUMN IF NOT EXISTS game VARCHAR(16) NOT NULL DEFAULT 'thrash_margin';

-- Action log (for replay and audit)
CREATE TABLE IF NOT EXISTS game_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  turn        INTEGER NOT NULL,
  action      JSONB NOT NULL,    -- GameAction payload
  result      JSONB,             -- optional result snapshot
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Player stats (denormalised for leaderboard)
CREATE TABLE IF NOT EXISTS player_stats (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  games_played  INTEGER NOT NULL DEFAULT 0,
  games_won     INTEGER NOT NULL DEFAULT 0,
  games_lost    INTEGER NOT NULL DEFAULT 0,
  avg_turns     NUMERIC(6,2),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feedback / bug reports / ideas, submitted by any signed-in user against any of the three
-- games (or 'general' for portal-wide feedback). Admin-only to read; any signed-in user can
-- submit. `user_id` is nullable with ON DELETE SET NULL so a deleted account doesn't take its
-- feedback history with it.
CREATE TABLE IF NOT EXISTS feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  game        VARCHAR(16) NOT NULL DEFAULT 'general',  -- 'thrash_margin' | 'niccolo' | 'tea_race' | 'general'
  type        VARCHAR(16) NOT NULL DEFAULT 'idea',     -- 'bug' | 'idea' | 'comment'
  message     TEXT NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'open',     -- 'open' | 'resolved'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_games_owner    ON games(owner_id);
CREATE INDEX IF NOT EXISTS idx_games_status   ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_owner_game ON games(owner_id, game);
CREATE INDEX IF NOT EXISTS idx_actions_game   ON game_actions(game_id);
CREATE INDEX IF NOT EXISTS idx_actions_turn   ON game_actions(game_id, turn);
CREATE INDEX IF NOT EXISTS idx_feedback_game   ON feedback(game);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER users_updated_at  BEFORE UPDATE ON users  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER games_updated_at  BEFORE UPDATE ON games  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
