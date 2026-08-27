-- Up Migration
-- Defense-in-depth for the login/suspension race: even if a caller observed ACTIVE
-- immediately before a restriction, PostgreSQL is the final authority for creating
-- a new API session. Restricted accounts may never receive a fresh auth_session.

CREATE OR REPLACE FUNCTION enforce_auth_session_active_user()
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
    RAISE EXCEPTION 'Auth session denied: account must be ACTIVE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_auth_session_active_user
BEFORE INSERT ON auth_sessions
FOR EACH ROW
EXECUTE FUNCTION enforce_auth_session_active_user();

REVOKE ALL ON FUNCTION enforce_auth_session_active_user() FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS trg_enforce_auth_session_active_user ON auth_sessions;
DROP FUNCTION IF EXISTS enforce_auth_session_active_user();
