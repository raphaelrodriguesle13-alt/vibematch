-- Up Migration
-- Persist only provider session references and public hosted URLs. No biometric media
-- or document payloads are stored in VibeMatch.

CREATE TABLE age_assurance_sessions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider_session_ref TEXT UNIQUE NOT NULL,
  verification_url TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('PENDING','APPROVED','REJECTED')) DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_age_assurance_sessions_provider_ref
  ON age_assurance_sessions(provider_session_ref);

GRANT SELECT, INSERT ON age_assurance_sessions TO svc_profile;
GRANT UPDATE (provider_session_ref, verification_url, status, updated_at)
  ON age_assurance_sessions TO svc_profile;

-- Down Migration
REVOKE ALL ON age_assurance_sessions FROM svc_profile;
DROP TABLE IF EXISTS age_assurance_sessions;
