-- Up Migration
-- VibeMatch — Blueprint V1.2 §2.2 (users, profiles, interests, match_intents)

CREATE TABLE users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_subject_id    TEXT UNIQUE NOT NULL,
  phone_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  status               TEXT NOT NULL
                         CHECK (status IN ('ACTIVE','SUSPENDED','PENDING_DELETION','DELETED'))
                         DEFAULT 'ACTIVE',
  age_assurance_status TEXT NOT NULL
                         CHECK (age_assurance_status IN ('NOT_STARTED','PENDING','APPROVED','REJECTED'))
                         DEFAULT 'NOT_STARTED',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_status ON users(status);

CREATE TABLE profiles (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url   TEXT,
  language     TEXT NOT NULL,
  region       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_profiles_lang_region ON profiles(language, region);

CREATE TABLE interests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT UNIQUE NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_interests (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest_id UUID NOT NULL REFERENCES interests(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, interest_id)
);
CREATE INDEX idx_user_interests_interest ON user_interests(interest_id);

-- MATCH INTENTS — V1.2 §3.1: responded_at = resposta humana; closed_at = fechamento sistêmico
CREATE TABLE match_intents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  receiver_id  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status       TEXT NOT NULL
                 CHECK (status IN ('SENT','ACCEPTED','DECLINED','EXPIRED','CANCELLED'))
                 DEFAULT 'SENT',
  expires_at   TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  closed_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_no_self_intent CHECK (sender_id <> receiver_id),
  CONSTRAINT chk_intent_timestamps CHECK (
    (responded_at IS NULL OR responded_at >= created_at) AND
    (closed_at    IS NULL OR closed_at    >= created_at)
  ),
  CONSTRAINT chk_intent_status_timestamps CHECK (
    (status = 'SENT'                    AND responded_at IS NULL     AND closed_at IS NULL)     OR
    (status IN ('ACCEPTED','DECLINED')  AND responded_at IS NOT NULL AND closed_at IS NULL)     OR
    (status IN ('EXPIRED','CANCELLED')  AND responded_at IS NULL     AND closed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_match_intent_pair_open
  ON match_intents(sender_id, receiver_id) WHERE status = 'SENT';
CREATE INDEX idx_match_intents_receiver ON match_intents(receiver_id, status);
CREATE INDEX idx_match_intents_expiry ON match_intents(expires_at) WHERE status = 'SENT';

-- Down Migration
DROP TABLE IF EXISTS match_intents;
DROP TABLE IF EXISTS user_interests;
DROP TABLE IF EXISTS interests;
DROP TABLE IF EXISTS profiles;
DROP TABLE IF EXISTS users;
