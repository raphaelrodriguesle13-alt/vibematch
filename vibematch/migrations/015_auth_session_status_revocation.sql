-- Up Migration
-- Any transition away from ACTIVE invalidates every API session for the account.
-- The trigger is database-enforced so alternate administrative write paths cannot bypass revocation.

CREATE OR REPLACE FUNCTION revoke_auth_sessions_on_account_restriction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE' THEN
    UPDATE public.auth_sessions
    SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
    WHERE user_id = NEW.id
      AND revoked_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION revoke_auth_sessions_on_account_restriction() FROM PUBLIC;

CREATE TRIGGER trg_revoke_auth_sessions_on_account_restriction
AFTER UPDATE OF status ON users
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION revoke_auth_sessions_on_account_restriction();

-- Down Migration
DROP TRIGGER IF EXISTS trg_revoke_auth_sessions_on_account_restriction ON users;
DROP FUNCTION IF EXISTS revoke_auth_sessions_on_account_restriction();
