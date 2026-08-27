import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { closeAll, ownerPool } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string };
type RevocationRow = { revoked_at: Date | null };

const first = <T extends QueryResultRow>(result: QueryResult<T>): T => {
  const row = result.rows[0];
  if (!row) throw new Error('Expected database row');
  return row;
};

const rollbackAndRelease = async (client: PoolClient): Promise<void> => {
  try {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
};

const createActiveUser = async (): Promise<string> => {
  const result = await ownerPool.query<IdRow>(
    `INSERT INTO users (google_subject_id)
     VALUES ($1)
     RETURNING id`,
    [`auth-race-${crypto.randomUUID()}`],
  );
  return first(result).id;
};

describe('Auth session/account restriction concurrency', () => {
  test('restriction that wins the user-row lock blocks a concurrent session insert', async () => {
    const userId = await createActiveUser();
    const restrictClient = await ownerPool.connect();
    const sessionClient = await ownerPool.connect();

    try {
      await restrictClient.query('BEGIN');
      await sessionClient.query('BEGIN');

      await restrictClient.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [userId]);

      let insertSettled = false;
      const insertPromise = sessionClient
        .query(
          `INSERT INTO auth_sessions (user_id, expires_at)
           VALUES ($1, clock_timestamp() + interval '15 minutes')`,
          [userId],
        )
        .finally(() => {
          insertSettled = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(insertSettled).toBe(false);

      await restrictClient.query('COMMIT');
      await expect(insertPromise).rejects.toThrow(/account must be ACTIVE/);
      await sessionClient.query('ROLLBACK');
    } finally {
      if (!restrictClient.released) {
        await rollbackAndRelease(restrictClient);
      }
      if (!sessionClient.released) {
        await rollbackAndRelease(sessionClient);
      }
    }
  });

  test('session insert that wins first is revoked when the concurrent restriction commits', async () => {
    const userId = await createActiveUser();
    const sessionClient = await ownerPool.connect();
    const restrictClient = await ownerPool.connect();
    let sessionId: string | null = null;

    try {
      await sessionClient.query('BEGIN');
      await restrictClient.query('BEGIN');

      const session = await sessionClient.query<IdRow>(
        `INSERT INTO auth_sessions (user_id, expires_at)
         VALUES ($1, clock_timestamp() + interval '15 minutes')
         RETURNING id`,
        [userId],
      );
      sessionId = first(session).id;

      let restrictionSettled = false;
      const restrictionPromise = restrictClient
        .query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [userId])
        .finally(() => {
          restrictionSettled = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(restrictionSettled).toBe(false);

      await sessionClient.query('COMMIT');
      await restrictionPromise;
      await restrictClient.query('COMMIT');

      const state = await ownerPool.query<RevocationRow>(
        'SELECT revoked_at FROM auth_sessions WHERE id = $1',
        [sessionId],
      );
      expect(first(state).revoked_at).toBeInstanceOf(Date);
    } finally {
      if (!sessionClient.released) {
        await rollbackAndRelease(sessionClient);
      }
      if (!restrictClient.released) {
        await rollbackAndRelease(restrictClient);
      }
      if (sessionId) {
        await ownerPool.query('DELETE FROM auth_sessions WHERE id = $1', [sessionId]);
      }
      await ownerPool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
  });
});
