-- Up Migration
-- VibeMatch — Blueprint V1.2 §3.1 / §4.1
-- Sessões de API são revogáveis server-side. O JWT carrega o session_id (jti),
-- mas a autoridade de revogação permanece no banco.

CREATE TABLE auth_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_auth_session_expiry CHECK (expires_at > created_at),
  CONSTRAINT chk_auth_session_revocation_time CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX idx_auth_sessions_user_active
  ON auth_sessions(user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE phone_verifications (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_verification_id TEXT UNIQUE NOT NULL,
  phone_hash               TEXT NOT NULL,
  expires_at               TIMESTAMPTZ NOT NULL,
  consumed_at              TIMESTAMPTZ,
  attempts                 INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_phone_verification_expiry CHECK (expires_at > created_at),
  CONSTRAINT chk_phone_verification_consumed_time
    CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX idx_phone_verifications_user_active
  ON phone_verifications(user_id, expires_at)
  WHERE consumed_at IS NULL;

REVOKE ALL ON auth_sessions, phone_verifications FROM PUBLIC;
GRANT SELECT, INSERT ON auth_sessions TO svc_auth;
GRANT UPDATE (revoked_at, last_seen_at) ON auth_sessions TO svc_auth;
GRANT SELECT, INSERT ON phone_verifications TO svc_auth;
GRANT UPDATE (consumed_at, attempts) ON phone_verifications TO svc_auth;

-- Down Migration
DROP TABLE IF EXISTS phone_verifications;
DROP TABLE IF EXISTS auth_sessions;
