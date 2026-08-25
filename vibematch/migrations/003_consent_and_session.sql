-- Up Migration
-- VibeMatch — Blueprint V1.2 §2.2/§2.3/§4.2
-- Núcleo da propriedade de segurança inviolável: Structural Consent Integrity.

CREATE TABLE consents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_intent_id     UUID UNIQUE NOT NULL REFERENCES match_intents(id) ON DELETE RESTRICT,
  user_a_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  user_b_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  user_a_status       TEXT NOT NULL CHECK (user_a_status IN ('PENDING','ACCEPTED','DECLINED')) DEFAULT 'PENDING',
  user_b_status       TEXT NOT NULL CHECK (user_b_status IN ('PENDING','ACCEPTED','DECLINED')) DEFAULT 'PENDING',
  status              TEXT NOT NULL
                        CHECK (status IN ('PENDING','ACCEPTED_BOTH','DECLINED','EXPIRED','CANCELLED'))
                        DEFAULT 'PENDING',
  cancellation_reason TEXT CHECK (cancellation_reason IN
                        ('BLOCK','ACCOUNT_DELETION','USER_SUSPENDED','MODERATION','SYSTEM')),
  expires_at          TIMESTAMPTZ NOT NULL,
  video_deadline      TIMESTAMPTZ,
  accepted_both_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_no_self_consent CHECK (user_a_id <> user_b_id),
  CONSTRAINT chk_accepted_both_iff_both_accepted CHECK (
    (status = 'ACCEPTED_BOTH')
      = (user_a_status = 'ACCEPTED' AND user_b_status = 'ACCEPTED'
         AND status NOT IN ('CANCELLED','EXPIRED'))
  ),
  CONSTRAINT chk_pending_has_no_terminal_substatus CHECK (
    status <> 'PENDING' OR
      (user_a_status <> 'DECLINED' AND user_b_status <> 'DECLINED'
       AND NOT (user_a_status = 'ACCEPTED' AND user_b_status = 'ACCEPTED'))
  ),
  CONSTRAINT chk_declined_requires_a_decline CHECK (
    status <> 'DECLINED' OR user_a_status = 'DECLINED' OR user_b_status = 'DECLINED'
  ),
  CONSTRAINT chk_cancelled_requires_reason CHECK (
    (status = 'CANCELLED') = (cancellation_reason IS NOT NULL)
  ),
  CONSTRAINT chk_accepted_both_at_present CHECK (
    status <> 'ACCEPTED_BOTH' OR accepted_both_at IS NOT NULL
  ),
  CONSTRAINT chk_video_deadline_after_acceptance CHECK (
    video_deadline IS NULL OR accepted_both_at IS NULL OR video_deadline > accepted_both_at
  )
);
CREATE INDEX idx_consents_status ON consents(status);
CREATE INDEX idx_consents_user_a ON consents(user_a_id, status);
CREATE INDEX idx_consents_user_b ON consents(user_b_id, status);
CREATE INDEX idx_consents_video_deadline ON consents(video_deadline) WHERE status = 'ACCEPTED_BOTH';

-- V1.2 §2.2 (B5): Consent deve corresponder a um MatchIntent ACCEPTED e aos mesmos participantes.
CREATE OR REPLACE FUNCTION enforce_consent_matches_intent()
RETURNS TRIGGER AS $$
DECLARE s UUID; r UUID; st TEXT;
BEGIN
  SELECT sender_id, receiver_id, status INTO s, r, st
    FROM match_intents WHERE id = NEW.match_intent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consent requires an existing MatchIntent (% not found)', NEW.match_intent_id;
  END IF;
  IF st IS DISTINCT FROM 'ACCEPTED' THEN
    RAISE EXCEPTION 'Consent requires an ACCEPTED MatchIntent (intent % is %)', NEW.match_intent_id, st;
  END IF;
  IF NOT ((NEW.user_a_id = s AND NEW.user_b_id = r)
       OR (NEW.user_a_id = r AND NEW.user_b_id = s)) THEN
    RAISE EXCEPTION 'Consent users do not match MatchIntent participants';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER trg_enforce_consent_matches_intent
BEFORE INSERT ON consents FOR EACH ROW
EXECUTE FUNCTION enforce_consent_matches_intent();

-- V1.2 §2.2/§3.2: terminais imutáveis; ACCEPTED nunca reverte a PENDING (histórico factual).
-- Checagem estrutural (id/match_intent_id/user_a_id/user_b_id/created_at) NÃO é repetida
-- aqui: vive exclusivamente em enforce_consent_structural_immutability(), disparada por
-- um trigger BEFORE UPDATE separado (ordem alfabética garante que "structural" roda antes
-- de "terminal" — nome dos triggers abaixo). Duplicar a checagem aqui seria código morto.
CREATE OR REPLACE FUNCTION enforce_consent_terminal_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('DECLINED','EXPIRED','CANCELLED')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Consent % is terminal (%): reopening is forbidden', OLD.id, OLD.status;
  END IF;
  IF OLD.user_a_status = 'ACCEPTED' AND NEW.user_a_status = 'PENDING' THEN
    RAISE EXCEPTION 'Cannot revert user_a_status from ACCEPTED to PENDING';
  END IF;
  IF OLD.user_b_status = 'ACCEPTED' AND NEW.user_b_status = 'PENDING' THEN
    RAISE EXCEPTION 'Cannot revert user_b_status from ACCEPTED to PENDING';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

-- V1.2 §2.5 / correção item 4: identificadores estruturais são imutáveis após INSERT.
-- Defesa dupla: column-level GRANT (migration 006) + este trigger.
CREATE OR REPLACE FUNCTION enforce_consent_structural_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Consent structural field is immutable: id';
  END IF;
  IF NEW.match_intent_id IS DISTINCT FROM OLD.match_intent_id THEN
    RAISE EXCEPTION 'Consent structural field is immutable: match_intent_id';
  END IF;
  IF NEW.user_a_id IS DISTINCT FROM OLD.user_a_id THEN
    RAISE EXCEPTION 'Consent structural field is immutable: user_a_id';
  END IF;
  IF NEW.user_b_id IS DISTINCT FROM OLD.user_b_id THEN
    RAISE EXCEPTION 'Consent structural field is immutable: user_b_id';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Consent structural field is immutable: created_at';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER trg_enforce_consent_structural_immutability
BEFORE UPDATE ON consents FOR EACH ROW
EXECUTE FUNCTION enforce_consent_structural_immutability();

CREATE TRIGGER trg_enforce_consent_terminal_immutability
BEFORE UPDATE ON consents FOR EACH ROW
EXECUTE FUNCTION enforce_consent_terminal_immutability();

-- V1.2 §4.2 — Consent Authenticity trail (append-only, hash-chained em 005).
CREATE TABLE consent_decisions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id       UUID NOT NULL REFERENCES consents(id) ON DELETE RESTRICT,
  acting_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision         TEXT NOT NULL CHECK (decision IN ('ACCEPTED','DECLINED')),
  decided_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  auth_session_ref TEXT NOT NULL,
  request_id       UUID NOT NULL,
  prev_hash        TEXT,
  row_hash         TEXT NOT NULL,  -- preenchido pelo trigger (BEFORE INSERT), não pelo chamador
  chain_seq        BIGINT GENERATED ALWAYS AS IDENTITY,
  UNIQUE (consent_id, acting_user_id),
  UNIQUE (request_id),
  UNIQUE (chain_seq)
);
CREATE INDEX idx_consent_decisions_consent ON consent_decisions(consent_id);

-- BLOCKS antes de SESSIONS: o trigger de elegibilidade referencia blocks.
CREATE TABLE blocks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CONSTRAINT chk_no_self_block CHECK (blocker_id <> blocked_id)
);
CREATE INDEX idx_blocks_blocked ON blocks(blocked_id);
CREATE INDEX idx_blocks_pair ON blocks(blocker_id, blocked_id);

CREATE TABLE sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id         UUID UNIQUE NOT NULL REFERENCES consents(id) ON DELETE RESTRICT,
  livekit_room       TEXT UNIQUE NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('CREATED','ACTIVE','ENDED')) DEFAULT 'CREATED',
  end_reason         TEXT CHECK (end_reason IN
                       ('USER_ENDED','BLOCK','ACCOUNT_DELETION','USER_SUSPENDED',
                        'MODERATION','CONSENT_INVALIDATED','TIMEOUT','SYSTEM_ERROR')),
  revocation_pending BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at         TIMESTAMPTZ,
  started_at         TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ended_has_reason CHECK ((status = 'ENDED') = (end_reason IS NOT NULL)),
  CONSTRAINT chk_ended_has_timestamp CHECK ((status = 'ENDED') = (ended_at IS NOT NULL)),
  CONSTRAINT chk_session_timestamps CHECK (
    (started_at IS NULL OR started_at >= created_at) AND
    (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
  )
);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_revocation ON sessions(revocation_pending) WHERE revocation_pending;

-- V1.2 §2.2 (B1/B4) — última linha de defesa estrutural no INSERT de Session.
CREATE OR REPLACE FUNCTION enforce_session_eligibility()
RETURNS TRIGGER AS $$
DECLARE c RECORD; ua TEXT; ub TEXT; blocked INT;
BEGIN
  SELECT * INTO c FROM consents WHERE id = NEW.consent_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session denied: consent % not found', NEW.consent_id;
  END IF;
  IF c.status IS DISTINCT FROM 'ACCEPTED_BOTH' THEN
    RAISE EXCEPTION 'Session denied: consent % is % (expected ACCEPTED_BOTH)', NEW.consent_id, c.status;
  END IF;
  IF c.video_deadline IS NOT NULL AND c.video_deadline <= now() THEN
    RAISE EXCEPTION 'Session denied: consent % video window expired', NEW.consent_id;
  END IF;
  SELECT status INTO ua FROM users WHERE id = c.user_a_id;
  SELECT status INTO ub FROM users WHERE id = c.user_b_id;
  IF ua IS DISTINCT FROM 'ACTIVE' OR ub IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'Session denied: participant not ACTIVE (a=%, b=%)', ua, ub;
  END IF;
  SELECT count(*) INTO blocked FROM blocks
   WHERE (blocker_id = c.user_a_id AND blocked_id = c.user_b_id)
      OR (blocker_id = c.user_b_id AND blocked_id = c.user_a_id);
  IF blocked > 0 THEN
    RAISE EXCEPTION 'Session denied: block exists between participants';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER trg_enforce_session_eligibility
BEFORE INSERT ON sessions FOR EACH ROW
EXECUTE FUNCTION enforce_session_eligibility();

-- Correção item 5/16: nenhuma função privilegiada chamável diretamente por PUBLIC.
-- PostgreSQL NÃO exige EXECUTE do papel para que um trigger dispare durante seu
-- próprio INSERT/UPDATE — o REVOKE abaixo só impede invocação DIRETA da função
-- (ex.: "SELECT enforce_session_eligibility()"), que é o vetor que a correção 16 pede
-- para testar. O disparo automático via trigger continua funcionando normalmente.
REVOKE ALL ON FUNCTION enforce_consent_matches_intent() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_consent_terminal_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_consent_structural_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_session_eligibility() FROM PUBLIC;

-- Down Migration
DROP TABLE IF EXISTS sessions;
DROP FUNCTION IF EXISTS enforce_session_eligibility();
DROP TABLE IF EXISTS blocks;
DROP TABLE IF EXISTS consent_decisions;
DROP TABLE IF EXISTS consents;
DROP FUNCTION IF EXISTS enforce_consent_structural_immutability();
DROP FUNCTION IF EXISTS enforce_consent_terminal_immutability();
DROP FUNCTION IF EXISTS enforce_consent_matches_intent();
