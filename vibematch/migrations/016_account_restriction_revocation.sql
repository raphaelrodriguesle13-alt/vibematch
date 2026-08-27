-- Up Migration
-- Account restriction is a global server-side safety boundary.
-- Leaving ACTIVE must revoke all restricted social/video state and prevent new state creation.

CREATE OR REPLACE FUNCTION enforce_match_intent_active_users()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  sender_status TEXT;
  receiver_status TEXT;
BEGIN
  SELECT status INTO sender_status FROM public.users WHERE id = NEW.sender_id;
  SELECT status INTO receiver_status FROM public.users WHERE id = NEW.receiver_id;

  IF sender_status IS DISTINCT FROM 'ACTIVE' OR receiver_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'Match intent denied: participants must be ACTIVE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_match_intent_active_users
BEFORE INSERT ON match_intents
FOR EACH ROW
EXECUTE FUNCTION enforce_match_intent_active_users();

CREATE OR REPLACE FUNCTION enforce_consent_active_users()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  user_a_status TEXT;
  user_b_status TEXT;
BEGIN
  SELECT status INTO user_a_status FROM public.users WHERE id = NEW.user_a_id;
  SELECT status INTO user_b_status FROM public.users WHERE id = NEW.user_b_id;

  IF user_a_status IS DISTINCT FROM 'ACTIVE' OR user_b_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'Consent denied: participants must be ACTIVE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_consent_active_users
BEFORE INSERT ON consents
FOR EACH ROW
EXECUTE FUNCTION enforce_consent_active_users();

CREATE OR REPLACE FUNCTION revoke_restricted_state_on_account_restriction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  cancellation_reason TEXT;
  session_end_reason TEXT;
  revoked_at TIMESTAMPTZ;
BEGIN
  IF NEW.status = 'ACTIVE' THEN
    RETURN NEW;
  END IF;

  revoked_at := clock_timestamp();
  cancellation_reason := CASE
    WHEN NEW.status = 'SUSPENDED' THEN 'USER_SUSPENDED'
    ELSE 'ACCOUNT_DELETION'
  END;
  session_end_reason := cancellation_reason;

  UPDATE public.match_intents
     SET status = 'CANCELLED',
         closed_at = COALESCE(closed_at, revoked_at)
   WHERE status = 'SENT'
     AND (sender_id = NEW.id OR receiver_id = NEW.id);

  UPDATE public.consents
     SET status = 'CANCELLED',
         cancellation_reason = cancellation_reason,
         updated_at = revoked_at
   WHERE status IN ('PENDING', 'ACCEPTED_BOTH')
     AND (user_a_id = NEW.id OR user_b_id = NEW.id);

  UPDATE public.sessions AS s
     SET status = 'ENDED',
         end_reason = session_end_reason,
         revocation_pending = TRUE,
         revoked_at = COALESCE(s.revoked_at, revoked_at),
         ended_at = COALESCE(s.ended_at, revoked_at)
    FROM public.consents AS c
   WHERE s.consent_id = c.id
     AND (c.user_a_id = NEW.id OR c.user_b_id = NEW.id)
     AND s.status IN ('CREATED', 'ACTIVE');

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_revoke_restricted_state_on_account_restriction
AFTER UPDATE OF status ON users
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION revoke_restricted_state_on_account_restriction();

REVOKE ALL ON FUNCTION enforce_match_intent_active_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_consent_active_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_restricted_state_on_account_restriction() FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS trg_revoke_restricted_state_on_account_restriction ON users;
DROP FUNCTION IF EXISTS revoke_restricted_state_on_account_restriction();
DROP TRIGGER IF EXISTS trg_enforce_consent_active_users ON consents;
DROP FUNCTION IF EXISTS enforce_consent_active_users();
DROP TRIGGER IF EXISTS trg_enforce_match_intent_active_users ON match_intents;
DROP FUNCTION IF EXISTS enforce_match_intent_active_users();
