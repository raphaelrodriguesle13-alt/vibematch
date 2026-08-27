import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { closeAll, ownerPool, withRollback } from '../../helpers/db';

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

const createUser = async (client: PoolClient): Promise<string> => {
  const result = await client.query<IdRow>(
    `INSERT INTO users (google_subject_id)
     VALUES ($1)
     RETURNING id`,
    [`age-guard-${randomUUID()}`],
  );
  return first(result).id;
};

describe('Age assurance/account restriction boundary', () => {
  test.each(['SUSPENDED', 'PENDING_DELETION', 'DELETED'])(
    '%s account cannot create an age-assurance provider session',
    async (status) => {
      await withRollback(ownerPool, async (client) => {
        const userId = await createUser(client);
        await client.query('UPDATE users SET status = $2 WHERE id = $1', [userId, status]);

        const message = await expectRejection(() =>
          client.query(
            `INSERT INTO age_assurance_sessions
               (user_id, provider_session_ref, verification_url, status)
             VALUES ($1, $2, 'https://verify.example.test/session', 'PENDING')`,
            [userId, `age-session-${randomUUID()}`],
          ),
        );

        expect(message).toMatch(/Age assurance write denied: account must be ACTIVE/);
      });
    },
  );

  test.each(['SUSPENDED', 'PENDING_DELETION', 'DELETED'])(
    '%s account cannot be elevated to age assurance APPROVED',
    async (status) => {
      await withRollback(ownerPool, async (client) => {
        const userId = await createUser(client);
        await client.query('UPDATE users SET status = $2 WHERE id = $1', [userId, status]);

        const message = await expectRejection(() =>
          client.query("UPDATE users SET age_assurance_status = 'APPROVED' WHERE id = $1", [
            userId,
          ]),
        );

        expect(message).toMatch(/Age assurance approval denied: account must be ACTIVE/);
      });
    },
  );

  test('restriction holding the user-row lock blocks a concurrent provider decision write', async () => {
    const setup = await ownerPool.connect();
    let userId = '';
    try {
      userId = await createUser(setup);
      await setup.query(
        `INSERT INTO age_assurance_sessions
           (user_id, provider_session_ref, verification_url, status)
         VALUES ($1, $2, 'https://verify.example.test/session', 'PENDING')`,
        [userId, `age-session-${randomUUID()}`],
      );
    } finally {
      setup.release();
    }

    const restrictClient = await ownerPool.connect();
    const decisionClient = await ownerPool.connect();
    let restrictCommitted = false;
    let decisionRolledBack = false;

    try {
      await restrictClient.query('BEGIN');
      await decisionClient.query('BEGIN');
      await restrictClient.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [userId]);

      let decisionSettled = false;
      const decisionPromise = decisionClient
        .query(
          `UPDATE age_assurance_sessions
           SET status = 'APPROVED', updated_at = clock_timestamp()
           WHERE user_id = $1`,
          [userId],
        )
        .finally(() => {
          decisionSettled = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(decisionSettled).toBe(false);

      await restrictClient.query('COMMIT');
      restrictCommitted = true;
      await expect(decisionPromise).rejects.toThrow(/account must be ACTIVE/);
      await decisionClient.query('ROLLBACK');
      decisionRolledBack = true;
    } finally {
      if (!restrictCommitted) await restrictClient.query('ROLLBACK').catch(() => undefined);
      if (!decisionRolledBack) await decisionClient.query('ROLLBACK').catch(() => undefined);
      restrictClient.release();
      decisionClient.release();
      if (userId) await ownerPool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
  });
});
