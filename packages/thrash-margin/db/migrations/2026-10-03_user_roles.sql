-- Admin access moves from the ADMIN_USERNAMES env var to a role on the user's own row, managed
-- from the portal's Admin page (/thrash-margin/admin).
--
-- Run once in the Supabase SQL editor. Idempotent: safe to run again.
--
-- Step 1 adds the column. Every existing and future account is an ordinary 'user'.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
  END IF;
END $$;

-- Step 2 bootstraps the first admin. The portal can only grant admin to someone who is already an
-- admin, so the very first one has to be set here. Replace the username below with your own
-- account's, exactly as you sign in with it, then run. After this, manage admins from the portal.
UPDATE users SET role = 'admin' WHERE username = 'REPLACE_WITH_YOUR_USERNAME';

-- Check: should list your account.
SELECT username, role FROM users WHERE role = 'admin';
