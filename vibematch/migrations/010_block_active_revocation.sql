-- Up Migration
-- A block must invalidate every open path between the two users immediately.

CREATE OR REPLACE FUNCTION revoke_restricted_state_on_block()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE match_intents
     SET status = 'CANCELLED',
         closed_at = COALESCE(closed_at, now())
   WHERE status = 'SENT'
     AND ((sender_id = NEW.blocker_id AND receiver_id = NEW.blocked_id)
       OR (sender_id = NEW.blocked_id AND receiver_id = NEW.blocker_id));

  UPDATE consents
     SET status = 'CANCELLED',
         cancellation_reason = 'BLOCK',
         updated_at = now()
   WHERE status IN ('PENDING', 'ACCEPTED_BOTH')
     AND ((user_a_id = NEW.blocker_id AND user_b_id = NEW.blocked_id)
       OR (user_a_id = NEW.blocked_id AND user_b_id = NEW.blocker_id));

  UPDATE sessions s
     SET status = 'ENDED',
         end_reason = 'BLOCK',
         revocation_pending = TRUE,
         revoked_at = COALESCE(s.revoked_at, now()),
         ended_at = COALESCE(s.ended_at, now())
    FROM consents c
   WHERE s.consent_id = c.id
     AND ((c.user_a_id = NEW.blocker_id AND c.user_b_id = NEW.blocked_id)
       OR (c.user_a_id = NEW.blocked_id AND c.user_b_id = NEW.blocker_id))
     AND s.status IN ('CREATED', 'ACTIVE');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

CREATE TRIGGER trg_revoke_restricted_state_on_block
AFTER INSERT ON blocks
FOR EACH ROW
EXECUTE FUNCTION revoke_restricted_state_on_block();

REVOKE ALL ON FUNCTION revoke_restricted_state_on_block() FROM PUBLIC;

-- Down Migration
DROP TRIGGER IF EXISTS trg_revoke_restricted_state_on_block ON blocks;
DROP FUNCTION IF EXISTS revoke_restricted_state_on_block();
