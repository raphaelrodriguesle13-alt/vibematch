import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { closeAll, ownerPool, seedAcceptedIntent, withRollback } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string };
type SessionStateRow = {
  status: string;
  end_reason: string | null;
  revocation_pending: boolean;
};

const first = <T extends QueryResultRow>(result: QueryResult<T>): T => {
  const row = result.rows[0];
  if (!row) throw new Error('Expected database row');
  return row;
};

const seedAcceptedConsent = async (
  client: PoolClient,
): Promise<{ consentId: string; userA: string }> => {
  const { userA, userB, intentId } = await seedAcceptedIntent(client);
  const result = await client.query<IdRow>(
    `INSERT INTO consents (
       match_intent_id, user_a_id, user_b_id, user_a_status, user_b_status,
       status, accepted_both_at, video_deadline, expires_at
     ) VALUES (
       $1, $2, $3, 'ACCEPTED', 'ACCEPTED', 'ACCEPTED_BOTH',
       now(), now() + interval '1 hour', now() + interval '1 hour'
     ) RETURNING id`,
    [intentId, userA, userB],
  );
  return { consentId: first(result).id, userA };
};

const expectRejection = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    throw new Error('EXPECTED REJECTION BUT STATEMENT SUCCEEDED');
  } catch (error) {
    const message = (error as Error).message;
    if (message === 'EXPECTED REJECTION BUT STATEMENT SUCCEEDED') throw error;
    return message;
  }
};

describe('Phone verification database boundary', () => {
  test('match intent creation fails closed when a participant is not phone verified', async () => {
    await withRollback(ownerPool, async (client) => {
      const sender = await client.query<IdRow>(
        `INSERT INTO users (google_subject_id, phone_verified, age_assurance_status)
         VALUES ($1, TRUE, 'APPROVED') RETURNING id`,
        [`phone-sender-${Math.random()}`],
      );
      const receiver = await client.query<IdRow>(
        `INSERT INTO users (google_subject_id, age_assurance_status)
         VALUES ($1, 'APPROVED') RETURNING id`,
        [`phone-receiver-${Math.random()}`],
      );

      const message = await expectRejection(() =>
        client.query(
          `INSERT INTO match_intents (sender_id, receiver_id, expires_at)
           VALUES ($1, $2, now() + interval '10 minutes')`,
          [first(sender).id, first(receiver).id],
        ),
      );

      expect(message).toMatch(/phone verification required/);
    });
  });

  test('consent creation fails closed if phone verification is lost after matching', async () => {
    await withRollback(ownerPool, async (client) => {
      const { userA, userB, intentId } = await seedAcceptedIntent(client);
      await client.query('UPDATE users SET phone_verified = FALSE WHERE id = $1', [userA]);

      const message = await expectRejection(() =>
        client.query(
          `INSERT INTO consents (match_intent_id, user_a_id, user_b_id, expires_at)
           VALUES ($1, $2, $3, now() + interval '10 minutes')`,
          [intentId, userA, userB],
        ),
      );

      expect(message).toMatch(/phone verification required/);
    });
  });

  test('session creation fails closed when a participant is not phone verified', async () => {
    await withRollback(ownerPool, async (client) => {
      const { consentId, userA } = await seedAcceptedConsent(client);
      await client.query('UPDATE users SET phone_verified = FALSE WHERE id = $1', [userA]);

      const message = await expectRejection(() =>
        client.query(
          `INSERT INTO sessions (consent_id, livekit_room) VALUES ($1, 'phone-denied')`,
          [consentId],
        ),
      );

      expect(message).toMatch(/phone verification required/);
    });
  });

  test('losing phone verification actively revokes an existing session', async () => {
    await withRollback(ownerPool, async (client) => {
      const { consentId, userA } = await seedAcceptedConsent(client);
      const session = await client.query<IdRow>(
        `INSERT INTO sessions (consent_id, livekit_room)
         VALUES ($1, 'phone-revocation') RETURNING id`,
        [consentId],
      );

      await client.query('UPDATE users SET phone_verified = FALSE WHERE id = $1', [userA]);

      const state = await client.query<SessionStateRow>(
        `SELECT status, end_reason, revocation_pending FROM sessions WHERE id = $1`,
        [first(session).id],
      );
      expect(first(state)).toMatchObject({
        status: 'ENDED',
        end_reason: 'CONSENT_INVALIDATED',
        revocation_pending: true,
      });
    });
  });
});
