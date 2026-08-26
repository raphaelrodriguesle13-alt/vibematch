-- Up Migration
-- Moderation evidence and severity must not be client- or service-forgeable.

ALTER TABLE reports
  ADD CONSTRAINT chk_report_category_known
  CHECK (category IN ('HARASSMENT','HATE','SEXUAL_CONTENT','SCAM','SPAM','OTHER'));

ALTER TABLE reports
  ADD CONSTRAINT chk_report_category_severity
  CHECK (
    (category IN ('HATE','SEXUAL_CONTENT') AND severity = 'CRITICAL') OR
    (category IN ('HARASSMENT','SCAM') AND severity = 'HIGH') OR
    (category = 'SPAM' AND severity = 'MEDIUM') OR
    (category = 'OTHER' AND severity = 'LOW')
  );

CREATE OR REPLACE FUNCTION enforce_report_session_membership()
RETURNS TRIGGER AS $$
DECLARE
  user_a UUID;
  user_b UUID;
BEGIN
  IF NEW.session_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.user_a_id, c.user_b_id
    INTO user_a, user_b
    FROM sessions s
    JOIN consents c ON c.id = s.consent_id
   WHERE s.id = NEW.session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report session % not found', NEW.session_id;
  END IF;

  IF NOT ((NEW.reporter_id = user_a AND NEW.reported_id = user_b)
       OR (NEW.reporter_id = user_b AND NEW.reported_id = user_a)) THEN
    RAISE EXCEPTION 'Report session does not belong to reporter/reported pair';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER trg_enforce_report_session_membership
BEFORE INSERT ON reports
FOR EACH ROW
EXECUTE FUNCTION enforce_report_session_membership();

CREATE OR REPLACE FUNCTION enforce_moderation_case_escalation()
RETURNS TRIGGER AS $$
DECLARE
  report_severity TEXT;
BEGIN
  SELECT severity INTO report_severity FROM reports WHERE id = NEW.report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Moderation case requires existing report';
  END IF;

  IF report_severity IN ('HIGH','CRITICAL') AND NEW.requires_human IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'High severity moderation case requires human review';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER trg_enforce_moderation_case_escalation
BEFORE INSERT OR UPDATE OF requires_human, report_id ON moderation_cases
FOR EACH ROW
EXECUTE FUNCTION enforce_moderation_case_escalation();

REVOKE ALL ON FUNCTION enforce_report_session_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_moderation_case_escalation() FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS trg_enforce_moderation_case_escalation ON moderation_cases;
DROP FUNCTION IF EXISTS enforce_moderation_case_escalation();
DROP TRIGGER IF EXISTS trg_enforce_report_session_membership ON reports;
DROP FUNCTION IF EXISTS enforce_report_session_membership();
ALTER TABLE reports DROP CONSTRAINT IF EXISTS chk_report_category_severity;
ALTER TABLE reports DROP CONSTRAINT IF EXISTS chk_report_category_known;
