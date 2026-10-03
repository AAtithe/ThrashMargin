-- The portal's complete database schema: every table the five games and the portal use.
--
-- This is the source of truth for rebuilding the database from nothing (a new Supabase project, a
-- restore, a test database). Paste it into the Supabase SQL editor, or `psql $DATABASE_URL -f
-- db/schema.sql`. Every statement is idempotent, so it is also safe to run against the live
-- database: it only adds what is missing.
--
-- The live database does not need it run by hand. The API adds every later column and table itself on first
-- use (shared/portal/server/schema.ts); keep both in step.
-- The CI API tests build their database from this file, so a table missing here fails CI.

-- Users
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username       VARCHAR(32) UNIQUE NOT NULL,
  email          VARCHAR(255) UNIQUE NOT NULL,
  password       VARCHAR(255) NOT NULL,
  last_login_at  TIMESTAMPTZ,
  role           VARCHAR(16) NOT NULL DEFAULT 'user' CONSTRAINT users_role_check CHECK (role IN ('user', 'admin')),
  -- Sessions issued before this are refused, so a password change signs out every device.
  password_changed_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent migration for the already-deployed instance — see the `games.game` migration
-- below for why this pattern is used instead of a separate numbered migration file.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'users_role_check' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
  END IF;
END $$;

-- Games
-- `game` discriminates which app owns this row so Thrash Margin, Banco di Niccolo, The Tea Race
-- (and any future game) can share one users/games/auth infrastructure instead of standing up a
-- second database. Existing rows predate this column and default to 'thrash_margin', so no
-- backfill is needed. There is deliberately no CHECK constraint on the value: adding a game means
-- adding a string, not running a migration. Keep new values within VARCHAR(16).
CREATE TABLE IF NOT EXISTS games (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game        VARCHAR(16) NOT NULL DEFAULT 'thrash_margin',  -- see GAMES in packages/thrash-margin/shared/games.ts
  mode        VARCHAR(16) NOT NULL DEFAULT 'single',  -- 'single' | 'pvp'
  status      VARCHAR(16) NOT NULL DEFAULT 'active',  -- 'active' | 'victory' | 'defeated'
  turn        INTEGER NOT NULL DEFAULT 1,
  version     INTEGER NOT NULL DEFAULT 0,                -- bumped on every save; see api/_lib/saves.ts
  state       JSONB NOT NULL,                          -- full GameState blob
  config      JSONB NOT NULL,                          -- GameConfig snapshot
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent migration for a database created before the `game` column existed (e.g. the
-- already-deployed Supabase instance) — running this file again against a fresh install is a
-- harmless no-op since the column is already in the CREATE TABLE above.
ALTER TABLE games ADD COLUMN IF NOT EXISTS game VARCHAR(16) NOT NULL DEFAULT 'thrash_margin';
ALTER TABLE games ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- Feedback / bug reports / ideas, submitted by any signed-in user against any of the portal's
-- games (or 'general' for portal-wide feedback). Admin-only to read; any signed-in user can
-- submit. `user_id` is nullable with ON DELETE SET NULL so a deleted account doesn't take its
-- feedback history with it.
CREATE TABLE IF NOT EXISTS feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  game        VARCHAR(16) NOT NULL DEFAULT 'general',  -- a game key, or 'general'
  type        VARCHAR(16) NOT NULL DEFAULT 'idea',     -- 'bug' | 'idea' | 'comment'
  message     TEXT NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'open',     -- 'open' | 'resolved'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sign-in attempt limit: one row per failed attempt, keyed on the lower-cased username (whether or
-- not the account exists). Rows older than a day are pruned on each failure.
CREATE TABLE IF NOT EXISTS login_failures (
  id            BIGSERIAL PRIMARY KEY,
  username_key  VARCHAR(64) NOT NULL,
  at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Permanent record of access changes made on the Admin page. Usernames are copied in so the history
-- still reads correctly after an account is deleted.
CREATE TABLE IF NOT EXISTS admin_audit (
  id               BIGSERIAL PRIMARY KEY,
  at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_username   VARCHAR(32) NOT NULL,
  target_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  target_username  VARCHAR(32) NOT NULL,
  action           VARCHAR(32) NOT NULL,  -- 'grant_admin' | 'remove_admin' | 'reset_password'
  detail           TEXT
);

-- Registration and feedback limits: one row per counted event, pruned after a day.
CREATE TABLE IF NOT EXISTS rate_events (
  id      BIGSERIAL PRIMARY KEY,
  bucket  VARCHAR(32) NOT NULL,   -- 'register' (key: network address) | 'feedback' (key: user id)
  key     VARCHAR(128) NOT NULL,
  at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- player_stats and game_actions, from the original single-game server, were never read by this API
-- and are no longer created. The API drops them from an existing database while they are empty.

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rate_events ON rate_events (bucket, key, at);
CREATE INDEX IF NOT EXISTS idx_login_failures_key_at ON login_failures (username_key, at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_at ON admin_audit (at DESC);
CREATE INDEX IF NOT EXISTS idx_games_owner    ON games(owner_id);
CREATE INDEX IF NOT EXISTS idx_games_status   ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_owner_game ON games(owner_id, game);
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
