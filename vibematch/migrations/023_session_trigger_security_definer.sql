-- Up Migration
-- Session eligibility triggers are server-side authorization boundaries. They must
-- read the protected consent/user/block rows with the migration owner privileges;
-- runtime roles retain only the minimum INSERT/SELECT surface required by the
-- VideoSessionRepository and cannot be granted broad trigger-read privileges.

CREATE OR REPLACE FUNCTION enforce_session_eligibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
END;
$$;

CREATE OR REPLACE FUNCTION enforce_session_age_assurance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  user_a UUID;
  user_b UUID;
  age_a TEXT;
  age_b TEXT;
BEGIN
  SELECT c.user_a_id, c.user_b_id
    INTO user_a, user_b
    FROM consents c
   WHERE c.id = NEW.consent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session denied: consent % not found for age assurance', NEW.consent_id;
  END IF;

  SELECT age_assurance_status INTO age_a FROM users WHERE id = user_a;
  SELECT age_assurance_status INTO age_b FROM users WHERE id = user_b;

  IF age_a IS DISTINCT FROM 'APPROVED' OR age_b IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION 'Session denied: age assurance not APPROVED';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_session_phone_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
$$;

REVOKE ALL ON FUNCTION enforce_session_eligibility() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_session_age_assurance() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_session_phone_verification() FROM PUBLIC;

-- Down Migration
-- Reverting this migration is intentionally a no-op: removing SECURITY DEFINER
-- would reintroduce a privilege failure for the least-privileged video role.
