-- Up Migration
-- Provider-neutral authentication identities.
-- Keeps the legacy users.google_subject_id column for compatibility while
-- allowing future PHONE and FACEBOOK entry points without manufacturing a
-- Google subject. Raw phone numbers must never be stored as external_subject;
-- PHONE identities use the server-side HMAC phone hash.

ALTER TABLE users
  ALTER COLUMN google_subject_id DROP NOT NULL;

CREATE TABLE auth_identities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL CHECK (provider IN ('GOOGLE','FACEBOOK','PHONE')),
  external_subject TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_auth_identity_subject_nonempty CHECK (btrim(external_subject) <> ''),
  CONSTRAINT uq_auth_identity_provider_subject UNIQUE (provider, external_subject),
  CONSTRAINT uq_auth_identity_user_provider UNIQUE (user_id, provider)
);

CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);

-- Backfill every existing Google account before new provider-aware code lands.
INSERT INTO auth_identities (user_id, provider, external_subject)
SELECT id, 'GOOGLE', google_subject_id
FROM users
WHERE google_subject_id IS NOT NULL
ON CONFLICT (provider, external_subject) DO NOTHING;

REVOKE ALL ON TABLE auth_identities FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE auth_identities TO svc_auth;

-- Down Migration
REVOKE ALL ON TABLE auth_identities FROM svc_auth;
DROP TABLE IF EXISTS auth_identities;

-- The down migration is intentionally fail-closed: a user created without a
-- Google identity cannot be represented by the legacy schema.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE google_subject_id IS NULL) THEN
    RAISE EXCEPTION 'cannot restore google_subject_id NOT NULL while non-Google users exist';
  END IF;
END
$$;

ALTER TABLE users
  ALTER COLUMN google_subject_id SET NOT NULL;
