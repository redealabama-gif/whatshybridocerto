-- 014_users_google_sub.sql
-- Adds Google OAuth identifier column to users so we can link a user to
-- their Google account independent of email (account linking + email
-- changes on Google's side stay safe).
--
-- `google_sub` is the stable subject (sub) claim from Google's id_token.
-- It never changes for a given Google account.
--
-- Users created via "Continue with Google" still have a non-null password
-- column (NOT NULL constraint preserved) — we store a bcrypt hash of a
-- random UUID so any password-based login attempt fails. The user must
-- either keep using Google OR go through forgot-password to set a real
-- password.

ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
