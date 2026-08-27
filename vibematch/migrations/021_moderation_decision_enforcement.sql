-- Up Migration
-- Moderation decisions that restrict an account must be authoritative and atomic.
-- The case decision is the auditable control point; downstream revocation is delegated
-- to the existing users.status restriction triggers in the same transaction.

CREATE OR REPLACE FUNCTION enforce_restrictive_moderation_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  reported_user_id UUID;
BEGIN
  IF NEW.decision IS NULL OR NEW.decision NOT IN ('SUSPENSION', 'BAN') THEN
    RETURN NEW;
  END IF;

  SELECT r.reported_id
    INTO reported_user_id
    FROM public.reports AS r
   WHERE r.id = NEW.report_id
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Moderation decision requires existing report';
  END IF;

  UPDATE public.reports
     SET status = 'RESOLVED'
   WHERE id = NEW.report_id
     AND status <> 'RESOLVED';

  UPDATE public.users
     SET status = 'SUSPENDED',
         updated_at = clock_timestamp()
   WHERE id = reported_user_id
     AND status = 'ACTIVE';

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_restrictive_moderation_decision
AFTER INSERT OR UPDATE OF decision ON moderation_cases
FOR EACH ROW
WHEN (NEW.decision IN ('SUSPENSION', 'BAN'))
EXECUTE FUNCTION enforce_restrictive_moderation_decision();

REVOKE ALL ON FUNCTION enforce_restrictive_moderation_decision() FROM PUBLIC;

-- Once moderation decisions are the audited control point, the runtime role no longer
-- needs arbitrary write access to account/session/consent state. Revocation happens via
-- the protected trigger and the existing account-restriction cascade.
REVOKE UPDATE (status, updated_at) ON users FROM svc_moderation;
REVOKE UPDATE (status, cancellation_reason, updated_at) ON consents FROM svc_moderation;
REVOKE UPDATE (status, end_reason, revocation_pending, revoked_at, ended_at)
  ON sessions FROM svc_moderation;

-- Down Migration
GRANT UPDATE (status, end_reason, revocation_pending, revoked_at, ended_at)
  ON sessions TO svc_moderation;
GRANT UPDATE (status, cancellation_reason, updated_at) ON consents TO svc_moderation;
GRANT UPDATE (status, updated_at) ON users TO svc_moderation;
DROP TRIGGER IF EXISTS trg_enforce_restrictive_moderation_decision ON moderation_cases;
DROP FUNCTION IF EXISTS enforce_restrictive_moderation_decision();
