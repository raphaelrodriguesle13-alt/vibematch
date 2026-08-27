import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { closeAll, ownerPool, seedAcceptedIntent, withRollback } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string };
type ConsentStateRow = { status: string; cancellation_reason: string | null };
type SessionStateRow = {
  status: string;
  end_reason: string | null;
  revocation_pending: boolean;
};

type IntentStateRow = { status: string; closed_at: Date | null };

const first = <T extends QueryResultRow>(result: QueryResult<T>): T => {
  const row = result.rows[0];
  if (!row) throw new Error('Expected database row');
  return row;
};

const seedAcceptedConsent = async (
  client: PoolClient,
): Promise<{ consentId: string; userA: string; userB: string }> => {
  const { userA, userB, intentId } = await seedAcceptedIntent(client);
  const consent = await client.query<IdRow>(
    `INSERT INTO consents (
       match_intent_id, user_a_id, user_b_id, user_a_status, user_b_status,
       status, accepted_both_at, video_deadline, expires_at
     ) VALUES (
       $1, $2, $3, 'ACCEPTED', 'ACCEPTED', 'ACCEPTED_BOTH',
       now(), now() + interval '1 hour', now() + interval '1 hour'
     ) RETURNING id`,
    [intentId, userA, userB],
  );
  return { consentId: first(consent).id, userA, userB };
};

describe('Block active revocation', () => {
  test('blocking immediately cancels accepted consent, ends video session, and revokes token authorization', async () => {
    await withRollback(ownerPool, async (client) => {
      const { consentId, userA, userB } = await seedAcceptedConsent(client);
      const session = await client.query<IdRow>(
        `INSERT INTO sessions (consent_id, livekit_room)
         VALUES ($1, 'block-revocation') RETURNING id`,
        [consentId],
      );
      const sessionId = first(session).id;

      const beforeBlock = await client.query<IdRow>(
        `SELECT s.id
         FROM sessions s
         JOIN consents c ON c.id = s.consent_id
         WHERE s.id = $1
           AND $2 IN (c.user_a_id, c.user_b_id)
           AND c.status = 'ACCEPTED_BOTH'
           AND c.video_deadline > now()
           AND s.status IN ('CREATED', 'ACTIVE')
           AND s.revocation_pending = FALSE
           AND s.revoked_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_id = c.user_a_id AND b.blocked_id = c.user_b_id)
                OR (b.blocker_id = c.user_b_id AND b.blocked_id = c.user_a_id)
           )`,
        [sessionId, userA],
      );
      expect(beforeBlock.rowCount).toBe(1);

      await client.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [
        userA,
        userB,
      ]);

      const consent = await client.query<ConsentStateRow>(
        'SELECT status, cancellation_reason FROM consents WHERE id = $1',
        [consentId],
      );
      expect(first(consent)).toEqual({ status: 'CANCELLED', cancellation_reason: 'BLOCK' });

      const state = await client.query<SessionStateRow>(
        'SELECT status, end_reason, revocation_pending FROM sessions WHERE id = $1',
        [sessionId],
      );
      expect(first(state)).toEqual({
        status: 'ENDED',
        end_reason: 'BLOCK',
        revocation_pending: true,
      });

      const afterBlock = await client.query<IdRow>(
        `SELECT s.id
         FROM sessions s
         JOIN consents c ON c.id = s.consent_id
         WHERE s.id = $1
           AND $2 IN (c.user_a_id, c.user_b_id)
           AND c.status = 'ACCEPTED_BOTH'
           AND c.video_deadline > now()
           AND s.status IN ('CREATED', 'ACTIVE')
           AND s.revocation_pending = FALSE
           AND s.revoked_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_id = c.user_a_id AND b.blocked_id = c.user_b_id)
                OR (b.blocker_id = c.user_b_id AND b.blocked_id = c.user_a_id)
           )`,
        [sessionId, userA],
      );
      expect(afterBlock.rowCount).toBe(0);
    });
  });

  test('blocking immediately cancels an open match intent in either direction', async () => {
    await withRollback(ownerPool, async (client) => {
      const a = await client.query<IdRow>(
        `INSERT INTO users (google_subject_id, phone_verified, age_assurance_status)
         VALUES ($1, TRUE, 'APPROVED') RETURNING id`,
        [`block-a-${Math.random()}`],
      );
      const b = await client.query<IdRow>(
        `INSERT INTO users (google_subject_id, phone_verified, age_assurance_status)
         VALUES ($1, TRUE, 'APPROVED') RETURNING id`,
        [`block-b-${Math.random()}`],
      );
      const intent = await client.query<IdRow>(
        `INSERT INTO match_intents (sender_id, receiver_id, expires_at)
         VALUES ($1, $2, now() + interval '10 minutes') RETURNING id`,
        [first(a).id, first(b).id],
      );

      await client.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [
        first(b).id,
        first(a).id,
      ]);

      const state = await client.query<IntentStateRow>(
        'SELECT status, closed_at FROM match_intents WHERE id = $1',
        [first(intent).id],
      );
      expect(first(state).status).toBe('CANCELLED');
      expect(first(state).closed_at).not.toBeNull();
    });
  });
});
