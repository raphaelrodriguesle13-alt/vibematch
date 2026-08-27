-- Up Migration
-- Age-assurance state is authorization-sensitive and must not advance for a restricted account.
-- User-row locking serializes provider-result persistence with suspension/deletion.

CREATE OR REPLACE FUNCTION enforce_age_assurance_session_active_user()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  account_status TEXT;
BEGIN
  SELECT status INTO account_status
    FROM public.users
   WHERE id = NEW.user_id
   FOR SHARE;

  IF account_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'Age assurance write denied: account must be ACTIVE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_age_assurance_session_active_user
BEFORE INSERT OR UPDATE ON age_assurance_sessions
FOR EACH ROW
EXECUTE FUNCTION enforce_age_assurance_session_active_user();

CREATE OR REPLACE FUNCTION enforce_age_assurance_approval_active_user()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.age_assurance_status = 'APPROVED' AND NEW.status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'Age assurance approval denied: account must be ACTIVE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_age_assurance_approval_active_user
BEFORE UPDATE OF age_assurance_status ON users
FOR EACH ROW
WHEN (OLD.age_assurance_status IS DISTINCT FROM NEW.age_assurance_status)
EXECUTE FUNCTION enforce_age_assurance_approval_active_user();

REVOKE ALL ON FUNCTION enforce_age_assurance_session_active_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_age_assurance_approval_active_user() FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS trg_enforce_age_assurance_approval_active_user ON users;
DROP FUNCTION IF EXISTS enforce_age_assurance_approval_active_user();
DROP TRIGGER IF EXISTS trg_enforce_age_assurance_session_active_user ON age_assurance_sessions;
DROP FUNCTION IF EXISTS enforce_age_assurance_session_active_user();
