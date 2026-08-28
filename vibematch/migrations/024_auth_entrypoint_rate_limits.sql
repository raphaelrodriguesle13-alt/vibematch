-- Up Migration
-- Extend distributed auth throttling to provider-backed entry points.
-- Runtime stores only SHA-256 fingerprints of key material; raw Google tokens,
-- user ids, phone numbers and refresh tokens are never persisted here.

ALTER TABLE auth_rate_limits
  DROP CONSTRAINT IF EXISTS auth_rate_limits_scope_check;

ALTER TABLE auth_rate_limits
  ADD CONSTRAINT auth_rate_limits_scope_check
  CHECK (scope IN ('GOOGLE_LOGIN','PHONE_START','PHONE_CONFIRM','REFRESH','LOGOUT_REFRESH'));

-- Down Migration
-- Preserve the expanded constraint on rollback to avoid making existing rows invalid.
