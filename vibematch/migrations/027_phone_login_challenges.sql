-- Up Migration
-- Anonymous phone-login challenges. Raw phone numbers and OTP codes are never
-- stored here: phone_hash is HMAC-SHA256 with the server-side PHONE_HASH_PEPPER.

CREATE TABLE phone_login_challenges (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_verification_id TEXT UNIQUE NOT NULL,
  phone_hash               TEXT NOT NULL,
  expires_at               TIMESTAMPTZ NOT NULL,
  consumed_at              TIMESTAMPTZ,
  attempts                 INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_phone_login_hash_nonempty CHECK (btrim(phone_hash) <> ''),
  CONSTRAINT chk_phone_login_provider_id_nonempty CHECK (btrim(provider_verification_id) <> ''),
  CONSTRAINT chk_phone_login_expiry CHECK (expires_at > created_at),
  CONSTRAINT chk_phone_login_consumed_after_create CHECK (
    consumed_at IS NULL OR consumed_at >= created_at
  )
);

CREATE INDEX idx_phone_login_challenges_pending
  ON phone_login_challenges(expires_at)
  WHERE consumed_at IS NULL;

REVOKE ALL ON TABLE phone_login_challenges FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE phone_login_challenges TO svc_auth;

-- Down Migration
REVOKE ALL ON TABLE phone_login_challenges FROM svc_auth;
DROP TABLE IF EXISTS phone_login_challenges;
