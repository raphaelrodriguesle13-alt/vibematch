import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { closeAll, ownerPool, seedAcceptedIntent, withRollback } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string };

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

const seedSession = async (
  client: PoolClient,
): Promise<{ sessionId: string; userA: string; userB: string }> => {
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
  const session = await client.query<IdRow>(
    `INSERT INTO sessions (consent_id, livekit_room)
     VALUES ($1, $2) RETURNING id`,
    [first(consent).id, `moderation-${Math.random()}`],
  );
  return { sessionId: first(session).id, userA, userB };
};

describe('Moderation database integrity', () => {
  test('rejects client-forged severity that does not match category', async () => {
    await withRollback(ownerPool, async (client) => {
      const { userA, userB } = await seedSession(client);
      const message = await expectRejection(() =>
        client.query(
          `INSERT INTO reports (reporter_id, reported_id, category, severity)
           VALUES ($1, $2, 'OTHER', 'CRITICAL')`,
          [userA, userB],
        ),
      );
      expect(message).toMatch(/chk_report_category_severity/);
    });
  });

  test('rejects a session id unrelated to the reporter/reported pair', async () => {
    await withRollback(ownerPool, async (client) => {
      const { sessionId, userA } = await seedSession(client);
      const outsider = await client.query<IdRow>(
        `INSERT INTO users (google_subject_id, phone_verified, age_assurance_status)
         VALUES ($1, TRUE, 'APPROVED') RETURNING id`,
        [`moderation-outsider-${Math.random()}`],
      );

      const message = await expectRejection(() =>
        client.query(
          `INSERT INTO reports (reporter_id, reported_id, session_id, category, severity)
           VALUES ($1, $2, $3, 'HARASSMENT', 'HIGH')`,
          [userA, first(outsider).id, sessionId],
        ),
      );
      expect(message).toMatch(/does not belong to reporter\/reported pair/);
    });
  });

  test('high severity reports cannot create a non-human moderation case', async () => {
    await withRollback(ownerPool, async (client) => {
      const { userA, userB } = await seedSession(client);
      const report = await client.query<IdRow>(
        `INSERT INTO reports (reporter_id, reported_id, category, severity)
         VALUES ($1, $2, 'HARASSMENT', 'HIGH') RETURNING id`,
        [userA, userB],
      );

      const message = await expectRejection(() =>
        client.query(
          `INSERT INTO moderation_cases (report_id, requires_human)
           VALUES ($1, FALSE)`,
          [first(report).id],
        ),
      );
      expect(message).toMatch(/requires human review/);
    });
  });
});
