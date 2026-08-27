-- Up Migration
-- Phone verification must never make a restricted account eligible again.
-- These guards serialize verification with account restriction at the user row.

CREATE OR REPLACE FUNCTION enforce_phone_verification_active_user()
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
    RAISE EXCEPTION 'Phone verification denied: account must be ACTIVE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_phone_verification_active_user
BEFORE INSERT ON phone_verifications
FOR EACH ROW
EXECUTE FUNCTION enforce_phone_verification_active_user();

CREATE OR REPLACE FUNCTION enforce_phone_verified_only_for_active_user()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.phone_verified IS TRUE AND NEW.status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'Phone verification denied: restricted account cannot become verified';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_phone_verified_only_for_active_user
BEFORE UPDATE OF phone_verified ON users
FOR EACH ROW
WHEN (OLD.phone_verified IS DISTINCT FROM NEW.phone_verified)
EXECUTE FUNCTION enforce_phone_verified_only_for_active_user();

REVOKE ALL ON FUNCTION enforce_phone_verification_active_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_phone_verified_only_for_active_user() FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS trg_enforce_phone_verified_only_for_active_user ON users;
DROP FUNCTION IF EXISTS enforce_phone_verified_only_for_active_user();
DROP TRIGGER IF EXISTS trg_enforce_phone_verification_active_user ON phone_verifications;
DROP FUNCTION IF EXISTS enforce_phone_verification_active_user();
