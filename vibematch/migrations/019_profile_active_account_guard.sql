-- Up Migration
-- Profile mutations are allowed only while the owning account is ACTIVE.
-- Locking the user row serializes profile writes with suspension/deletion.

CREATE OR REPLACE FUNCTION enforce_profile_active_user()
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
    RAISE EXCEPTION 'Profile write denied: account must be ACTIVE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_profile_active_user
BEFORE INSERT OR UPDATE ON profiles
FOR EACH ROW
EXECUTE FUNCTION enforce_profile_active_user();

CREATE OR REPLACE FUNCTION enforce_user_interest_active_user()
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
    RAISE EXCEPTION 'Profile interest write denied: account must be ACTIVE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_user_interest_active_user
BEFORE INSERT OR UPDATE ON user_interests
FOR EACH ROW
EXECUTE FUNCTION enforce_user_interest_active_user();

REVOKE ALL ON FUNCTION enforce_profile_active_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_user_interest_active_user() FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS trg_enforce_user_interest_active_user ON user_interests;
DROP FUNCTION IF EXISTS enforce_user_interest_active_user();
DROP TRIGGER IF EXISTS trg_enforce_profile_active_user ON profiles;
DROP FUNCTION IF EXISTS enforce_profile_active_user();
