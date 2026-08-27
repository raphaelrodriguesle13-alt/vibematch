-- Up Migration
-- Opaque refresh tokens for revocable API sessions.
-- Raw refresh tokens never reach PostgreSQL: only SHA-256 hex digests are stored.

ALTER TABLE auth_sessions
  ADD COLUMN refresh_token_hash TEXT,
  ADD COLUMN refresh_previous_token_hash TEXT,
  ADD COLUMN refresh_expires_at TIMESTAMPTZ;

ALTER TABLE auth_sessions
  ADD CONSTRAINT chk_auth_session_refresh_hash
    CHECK (refresh_token_hash IS NULL OR refresh_token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT chk_auth_session_previous_refresh_hash
    CHECK (refresh_previous_token_hash IS NULL OR refresh_previous_token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT chk_auth_session_refresh_expiry
    CHECK (refresh_expires_at IS NULL OR refresh_expires_at > created_at),
  ADD CONSTRAINT chk_auth_session_refresh_pair
    CHECK ((refresh_token_hash IS NULL) = (refresh_expires_at IS NULL));

CREATE UNIQUE INDEX idx_auth_sessions_refresh_token_hash
  ON auth_sessions(refresh_token_hash)
  WHERE refresh_token_hash IS NOT NULL;

CREATE INDEX idx_auth_sessions_previous_refresh_token_hash
  ON auth_sessions(refresh_previous_token_hash)
  WHERE refresh_previous_token_hash IS NOT NULL AND revoked_at IS NULL;

GRANT UPDATE (expires_at, refresh_token_hash, refresh_previous_token_hash, refresh_expires_at)
  ON auth_sessions TO svc_auth;

-- Down Migration
REVOKE UPDATE (expires_at, refresh_token_hash, refresh_previous_token_hash, refresh_expires_at)
  ON auth_sessions FROM svc_auth;
DROP INDEX IF EXISTS idx_auth_sessions_previous_refresh_token_hash;
DROP INDEX IF EXISTS idx_auth_sessions_refresh_token_hash;
ALTER TABLE auth_sessions
  DROP CONSTRAINT IF EXISTS chk_auth_session_refresh_pair,
  DROP CONSTRAINT IF EXISTS chk_auth_session_refresh_expiry,
  DROP CONSTRAINT IF EXISTS chk_auth_session_previous_refresh_hash,
  DROP CONSTRAINT IF EXISTS chk_auth_session_refresh_hash,
  DROP COLUMN IF EXISTS refresh_expires_at,
  DROP COLUMN IF EXISTS refresh_previous_token_hash,
  DROP COLUMN IF EXISTS refresh_token_hash;
