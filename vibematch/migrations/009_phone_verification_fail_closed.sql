-- Up Migration
-- Phone verification is a server-side safety boundary for restricted flows.

CREATE OR REPLACE FUNCTION enforce_match_intent_phone_verification()
RETURNS TRIGGER AS $$
DECLARE
  sender_verified BOOLEAN;
  receiver_verified BOOLEAN;
BEGIN
  SELECT phone_verified INTO sender_verified FROM users WHERE id = NEW.sender_id;
  SELECT phone_verified INTO receiver_verified FROM users WHERE id = NEW.receiver_id;

  IF sender_verified IS DISTINCT FROM TRUE OR receiver_verified IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Match intent denied: phone verification required';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER trg_enforce_match_intent_phone_verification
BEFORE INSERT ON match_intents
FOR EACH ROW
EXECUTE FUNCTION enforce_match_intent_phone_verification();

CREATE OR REPLACE FUNCTION enforce_consent_phone_verification()
RETURNS TRIGGER AS $$
DECLARE
  phone_a BOOLEAN;
  phone_b BOOLEAN;
BEGIN
  SELECT phone_verified INTO phone_a FROM users WHERE id = NEW.user_a_id;
  SELECT phone_verified INTO phone_b FROM users WHERE id = NEW.user_b_id;

  IF phone_a IS DISTINCT FROM TRUE OR phone_b IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Consent denied: phone verification required';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER trg_enforce_consent_phone_verification
BEFORE INSERT ON consents
FOR EACH ROW
EXECUTE FUNCTION enforce_consent_phone_verification();

CREATE OR REPLACE FUNCTION enforce_session_phone_verification()
RETURNS TRIGGER AS $$
DECLARE
  user_a UUID;
  user_b UUID;
  phone_a BOOLEAN;
  phone_b BOOLEAN;
BEGIN
  SELECT c.user_a_id, c.user_b_id
    INTO user_a, user_b
    FROM consents c
   WHERE c.id = NEW.consent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session denied: consent % not found for phone verification', NEW.consent_id;
  END IF;

  SELECT phone_verified INTO phone_a FROM users WHERE id = user_a;
  SELECT phone_verified INTO phone_b FROM users WHERE id = user_b;

  IF phone_a IS DISTINCT FROM TRUE OR phone_b IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Session denied: phone verification required';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER trg_enforce_session_phone_verification
BEFORE INSERT ON sessions
FOR EACH ROW
EXECUTE FUNCTION enforce_session_phone_verification();

CREATE OR REPLACE FUNCTION revoke_sessions_on_phone_unverified()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.phone_verified IS DISTINCT FROM TRUE THEN
    UPDATE sessions s
       SET status = 'ENDED',
           end_reason = 'CONSENT_INVALIDATED',
           revocation_pending = TRUE,
           revoked_at = COALESCE(s.revoked_at, now()),
           ended_at = COALESCE(s.ended_at, now())
      FROM consents c
     WHERE s.consent_id = c.id
       AND (c.user_a_id = NEW.id OR c.user_b_id = NEW.id)
       AND s.status IN ('CREATED', 'ACTIVE');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

CREATE TRIGGER trg_revoke_sessions_on_phone_unverified
AFTER UPDATE OF phone_verified ON users
FOR EACH ROW
WHEN (OLD.phone_verified IS DISTINCT FROM NEW.phone_verified)
EXECUTE FUNCTION revoke_sessions_on_phone_unverified();

REVOKE ALL ON FUNCTION enforce_match_intent_phone_verification() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_consent_phone_verification() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_session_phone_verification() FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_sessions_on_phone_unverified() FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS trg_revoke_sessions_on_phone_unverified ON users;
DROP FUNCTION IF EXISTS revoke_sessions_on_phone_unverified();
DROP TRIGGER IF EXISTS trg_enforce_session_phone_verification ON sessions;
DROP FUNCTION IF EXISTS enforce_session_phone_verification();
DROP TRIGGER IF EXISTS trg_enforce_consent_phone_verification ON consents;
DROP FUNCTION IF EXISTS enforce_consent_phone_verification();
DROP TRIGGER IF EXISTS trg_enforce_match_intent_phone_verification ON match_intents;
DROP FUNCTION IF EXISTS enforce_match_intent_phone_verification();
