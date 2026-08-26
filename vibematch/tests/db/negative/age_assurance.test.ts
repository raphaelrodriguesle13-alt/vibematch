import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { closeAll, ownerPool, seedAcceptedIntent, withRollback } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string };
type SessionStateRow = {
  status: string;
  end_reason: string | null;
  revocation_pending: boolean;
  revoked_at: Date | null;
  ended_at: Date | null;
};

const first = <T extends QueryResultRow>(result: QueryResult<T>): T => {
  const row = result.rows[0];
  if (!row) throw new Error('Expected database row');
  return row;
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

const seedAcceptedConsent = async (
  client: PoolClient,
): Promise<{ consentId: string; userA: string; userB: string }> => {
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
  return { consentId: first(result).id, userA, userB };
};

describe('Age assurance database boundary', () => {
  test.each(['NOT_STARTED', 'PENDING', 'REJECTED'])(
    'session creation fails closed when a participant is %s',
    async (status) => {
      await withRollback(ownerPool, async (client) => {
        const { consentId, userA } = await seedAcceptedConsent(client);
        await client.query(`UPDATE users SET age_assurance_status = $2 WHERE id = $1`, [
          userA,
          status,
        ]);

        const message = await expectRejection(() =>
          client.query(
            `INSERT INTO sessions (consent_id, livekit_room)
             VALUES ($1, $2)`,
            [consentId, `age-denied-${status}`],
          ),
        );

        expect(message).toMatch(/age assurance not APPROVED/);
      });
    },
  );

  test('losing age approval actively revokes an existing session', async () => {
    await withRollback(ownerPool, async (client) => {
      const { consentId, userA } = await seedAcceptedConsent(client);
      const session = await client.query<IdRow>(
        `INSERT INTO sessions (consent_id, livekit_room)
         VALUES ($1, 'age-revocation') RETURNING id`,
        [consentId],
      );

      await client.query(`UPDATE users SET age_assurance_status = 'REJECTED' WHERE id = $1`, [
        userA,
      ]);

      const state = await client.query<SessionStateRow>(
        `SELECT status, end_reason, revocation_pending, revoked_at, ended_at
         FROM sessions WHERE id = $1`,
        [first(session).id],
      );
      expect(first(state)).toMatchObject({
        status: 'ENDED',
        end_reason: 'CONSENT_INVALIDATED',
        revocation_pending: true,
      });
      expect(first(state).revoked_at).not.toBeNull();
      expect(first(state).ended_at).not.toBeNull();
    });
  });

  test('account suspension actively revokes an existing session', async () => {
    await withRollback(ownerPool, async (client) => {
      const { consentId, userB } = await seedAcceptedConsent(client);
      const session = await client.query<IdRow>(
        `INSERT INTO sessions (consent_id, livekit_room)
         VALUES ($1, 'suspension-revocation') RETURNING id`,
        [consentId],
      );

      await client.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [userB]);

      const state = await client.query<SessionStateRow>(
        `SELECT status, end_reason, revocation_pending, revoked_at, ended_at
         FROM sessions WHERE id = $1`,
        [first(session).id],
      );
      expect(first(state)).toMatchObject({
        status: 'ENDED',
        end_reason: 'USER_SUSPENDED',
        revocation_pending: true,
      });
    });
  });
});
