-- Up Migration
-- Age assurance is a server-side safety boundary. Session creation and continued
-- participation both fail closed unless every participant remains APPROVED.

CREATE OR REPLACE FUNCTION enforce_session_age_assurance()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER trg_enforce_session_age_assurance
BEFORE INSERT ON sessions
FOR EACH ROW
EXECUTE FUNCTION enforce_session_age_assurance();

-- SECURITY DEFINER is intentional: svc_profile owns the age status transition but must
-- not receive UPDATE privileges on sessions. The trigger performs only the narrowly
-- scoped revocation while using a fixed search_path and no caller-controlled SQL.
CREATE OR REPLACE FUNCTION revoke_sessions_on_user_restriction()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'ACTIVE'
     OR NEW.age_assurance_status IS DISTINCT FROM 'APPROVED' THEN
    UPDATE sessions s
       SET status = 'ENDED',
           end_reason = CASE
             WHEN NEW.status = 'SUSPENDED' THEN 'USER_SUSPENDED'
             WHEN NEW.status IN ('PENDING_DELETION', 'DELETED') THEN 'ACCOUNT_DELETION'
             ELSE 'CONSENT_INVALIDATED'
           END,
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
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public;

CREATE TRIGGER trg_revoke_sessions_on_user_restriction
AFTER UPDATE OF status, age_assurance_status ON users
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.age_assurance_status IS DISTINCT FROM NEW.age_assurance_status
)
EXECUTE FUNCTION revoke_sessions_on_user_restriction();

REVOKE ALL ON FUNCTION enforce_session_age_assurance() FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_sessions_on_user_restriction() FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS trg_revoke_sessions_on_user_restriction ON users;
DROP FUNCTION IF EXISTS revoke_sessions_on_user_restriction();
DROP TRIGGER IF EXISTS trg_enforce_session_age_assurance ON sessions;
DROP FUNCTION IF EXISTS enforce_session_age_assurance();
