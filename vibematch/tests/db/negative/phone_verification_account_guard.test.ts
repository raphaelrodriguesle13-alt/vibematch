import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { closeAll, ownerPool, withRollback } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string };
type UserStateRow = { status: string; phone_verified: boolean };

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
    [`phone-guard-${randomUUID()}`],
  );
  return first(result).id;
};

describe('Phone verification/account restriction boundary', () => {
  test.each(['SUSPENDED', 'PENDING_DELETION', 'DELETED'])(
    '%s account cannot create a new phone verification',
    async (status) => {
      await withRollback(ownerPool, async (client) => {
        const userId = await createUser(client);
        await client.query('UPDATE users SET status = $2 WHERE id = $1', [userId, status]);

        const message = await expectRejection(() =>
          client.query(
            `INSERT INTO phone_verifications
               (user_id, provider_verification_id, phone_hash, expires_at)
             VALUES ($1, $2, repeat('a', 64), clock_timestamp() + interval '10 minutes')`,
            [userId, `provider-${randomUUID()}`],
          ),
        );

        expect(message).toMatch(/account must be ACTIVE/);
      });
    },
  );

  test.each(['SUSPENDED', 'PENDING_DELETION', 'DELETED'])(
    '%s account cannot be changed to phone_verified=true',
    async (status) => {
      await withRollback(ownerPool, async (client) => {
        const userId = await createUser(client);
        await client.query('UPDATE users SET status = $2 WHERE id = $1', [userId, status]);

        const message = await expectRejection(() =>
          client.query('UPDATE users SET phone_verified = TRUE WHERE id = $1', [userId]),
        );

        expect(message).toMatch(/restricted account cannot become verified/);
      });
    },
  );

  test('restriction holding the user-row lock makes a concurrent verification insert fail closed', async () => {
    const setup = await ownerPool.connect();
    const restrictClient = await ownerPool.connect();
    const verificationClient = await ownerPool.connect();
    let userId = '';
    let restrictCommitted = false;
    let verificationRolledBack = false;

    try {
      userId = await createUser(setup);
      setup.release();

      await restrictClient.query('BEGIN');
      await verificationClient.query('BEGIN');
      await restrictClient.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [userId]);

      let insertSettled = false;
      const insertPromise = verificationClient
        .query(
          `INSERT INTO phone_verifications
             (user_id, provider_verification_id, phone_hash, expires_at)
           VALUES ($1, $2, repeat('b', 64), clock_timestamp() + interval '10 minutes')`,
          [userId, `provider-${randomUUID()}`],
        )
        .finally(() => {
          insertSettled = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(insertSettled).toBe(false);

      await restrictClient.query('COMMIT');
      restrictCommitted = true;
      await expect(insertPromise).rejects.toThrow(/account must be ACTIVE/);
      await verificationClient.query('ROLLBACK');
      verificationRolledBack = true;

      const state = await ownerPool.query<UserStateRow>(
        'SELECT status, phone_verified FROM users WHERE id = $1',
        [userId],
      );
      expect(first(state)).toEqual({ status: 'SUSPENDED', phone_verified: false });
    } finally {
      if (!restrictCommitted) await restrictClient.query('ROLLBACK').catch(() => undefined);
      if (!verificationRolledBack) {
        await verificationClient.query('ROLLBACK').catch(() => undefined);
      }
      restrictClient.release();
      verificationClient.release();
      if (userId) await ownerPool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
  });
});
