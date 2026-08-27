import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { closeAll, ownerPool, seedAcceptedIntent, withRollback } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string };
type IntentStateRow = { status: string; closed_at: Date | null };
type ConsentStateRow = { status: string; cancellation_reason: string | null };
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

const seedAcceptedConsentAndSession = async (
  client: PoolClient,
  roomName: string,
): Promise<{
  userA: string;
  userB: string;
  intentId: string;
  consentId: string;
  sessionId: string;
}> => {
  const { userA, userB, intentId } = await seedAcceptedIntent(client);
  const consent = await client.query<IdRow>(
    `INSERT INTO consents (
       match_intent_id, user_a_id, user_b_id, user_a_status, user_b_status,
       status, accepted_both_at, video_deadline, expires_at
     ) VALUES (
       $1, $2, $3, 'ACCEPTED', 'ACCEPTED', 'ACCEPTED_BOTH',
       clock_timestamp(), clock_timestamp() + interval '1 hour', clock_timestamp() + interval '1 hour'
     ) RETURNING id`,
    [intentId, userA, userB],
  );
  const consentId = first(consent).id;
  const session = await client.query<IdRow>(
    `INSERT INTO sessions (consent_id, livekit_room, status, started_at)
     VALUES ($1, $2, 'ACTIVE', clock_timestamp())
     RETURNING id`,
    [consentId, roomName],
  );
  return { userA, userB, intentId, consentId, sessionId: first(session).id };
};

describe('Account restriction active revocation', () => {
  test('suspension cancels open matchmaking and consent and queues active video for LiveKit revocation', async () => {
    await withRollback(ownerPool, async (client) => {
      const seeded = await seedAcceptedConsentAndSession(client, `suspend-${Math.random()}`);
      const third = await client.query<IdRow>(
        `INSERT INTO users (google_subject_id, phone_verified, age_assurance_status)
         VALUES ($1, TRUE, 'APPROVED') RETURNING id`,
        [`restriction-third-${Math.random()}`],
      );
      const openIntent = await client.query<IdRow>(
        `INSERT INTO match_intents (sender_id, receiver_id, expires_at)
         VALUES ($1, $2, clock_timestamp() + interval '10 minutes') RETURNING id`,
        [seeded.userA, first(third).id],
      );

      await client.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [seeded.userA]);

      const intent = await client.query<IntentStateRow>(
        'SELECT status, closed_at FROM match_intents WHERE id = $1',
        [first(openIntent).id],
      );
      expect(first(intent).status).toBe('CANCELLED');
      expect(first(intent).closed_at).not.toBeNull();

      const consent = await client.query<ConsentStateRow>(
        'SELECT status, cancellation_reason FROM consents WHERE id = $1',
        [seeded.consentId],
      );
      expect(first(consent)).toEqual({
        status: 'CANCELLED',
        cancellation_reason: 'USER_SUSPENDED',
      });

      const session = await client.query<SessionStateRow>(
        `SELECT status, end_reason, revocation_pending, revoked_at, ended_at
         FROM sessions WHERE id = $1`,
        [seeded.sessionId],
      );
      expect(first(session).status).toBe('ENDED');
      expect(first(session).end_reason).toBe('USER_SUSPENDED');
      expect(first(session).revocation_pending).toBe(true);
      expect(first(session).revoked_at).not.toBeNull();
      expect(first(session).ended_at).not.toBeNull();
    });
  });

  test.each(['PENDING_DELETION', 'DELETED'] as const)(
    '%s uses account deletion semantics for consent and video revocation',
    async (status) => {
      await withRollback(ownerPool, async (client) => {
        const seeded = await seedAcceptedConsentAndSession(
          client,
          `delete-${status.toLowerCase()}-${Math.random()}`,
        );

        await client.query('UPDATE users SET status = $2 WHERE id = $1', [seeded.userA, status]);

        const consent = await client.query<ConsentStateRow>(
          'SELECT status, cancellation_reason FROM consents WHERE id = $1',
          [seeded.consentId],
        );
        expect(first(consent)).toEqual({
          status: 'CANCELLED',
          cancellation_reason: 'ACCOUNT_DELETION',
        });

        const session = await client.query<SessionStateRow>(
          `SELECT status, end_reason, revocation_pending, revoked_at, ended_at
           FROM sessions WHERE id = $1`,
          [seeded.sessionId],
        );
        expect(first(session).status).toBe('ENDED');
        expect(first(session).end_reason).toBe('ACCOUNT_DELETION');
        expect(first(session).revocation_pending).toBe(true);
      });
    },
  );

  test('restricted users cannot create new match intents', async () => {
    await withRollback(ownerPool, async (client) => {
      const restricted = await client.query<IdRow>(
        `INSERT INTO users (google_subject_id, phone_verified, age_assurance_status, status)
         VALUES ($1, TRUE, 'APPROVED', 'SUSPENDED') RETURNING id`,
        [`restricted-match-${Math.random()}`],
      );
      const active = await client.query<IdRow>(
        `INSERT INTO users (google_subject_id, phone_verified, age_assurance_status)
         VALUES ($1, TRUE, 'APPROVED') RETURNING id`,
        [`active-match-${Math.random()}`],
      );

      await expect(
        client.query(
          `INSERT INTO match_intents (sender_id, receiver_id, expires_at)
           VALUES ($1, $2, clock_timestamp() + interval '10 minutes')`,
          [first(restricted).id, first(active).id],
        ),
      ).rejects.toThrow('participants must be ACTIVE');
    });
  });

  test('accepted intents cannot be converted into consent after a participant becomes restricted', async () => {
    await withRollback(ownerPool, async (client) => {
      const { userA, userB, intentId } = await seedAcceptedIntent(client);
      await client.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [userA]);

      await expect(
        client.query(
          `INSERT INTO consents (match_intent_id, user_a_id, user_b_id, expires_at)
           VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour')`,
          [intentId, userA, userB],
        ),
      ).rejects.toThrow('participants must be ACTIVE');
    });
  });
});
