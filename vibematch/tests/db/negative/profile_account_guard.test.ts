import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { closeAll, ownerPool, withRollback } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string };

type ProfileRow = { display_name: string };

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
    [`profile-guard-${randomUUID()}`],
  );
  return first(result).id;
};

describe('Profile/account restriction boundary', () => {
  test.each(['SUSPENDED', 'PENDING_DELETION', 'DELETED'])(
    '%s account cannot create or update profile state',
    async (status) => {
      await withRollback(ownerPool, async (client) => {
        const userId = await createUser(client);
        await client.query('UPDATE users SET status = $2 WHERE id = $1', [userId, status]);

        const message = await expectRejection(() =>
          client.query(
            `INSERT INTO profiles (user_id, display_name, language, region)
             VALUES ($1, 'Blocked User', 'pt-BR', 'BR')`,
            [userId],
          ),
        );

        expect(message).toMatch(/Profile write denied: account must be ACTIVE/);
      });
    },
  );

  test('profile write that wins first remains atomic and a later restriction becomes authoritative', async () => {
    const userId = await ownerPool
      .query<IdRow>(
        `INSERT INTO users (google_subject_id)
         VALUES ($1)
         RETURNING id`,
        [`profile-race-${randomUUID()}`],
      )
      .then(first)
      .then((row) => row.id);
    const profileClient = await ownerPool.connect();
    const restrictClient = await ownerPool.connect();
    let profileCommitted = false;
    let restrictCommitted = false;

    try {
      await profileClient.query('BEGIN');
      await restrictClient.query('BEGIN');

      await profileClient.query(
        `INSERT INTO profiles (user_id, display_name, language, region)
         VALUES ($1, 'Race User', 'pt-BR', 'BR')`,
        [userId],
      );

      let restrictionSettled = false;
      const restrictionPromise = restrictClient
        .query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [userId])
        .finally(() => {
          restrictionSettled = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(restrictionSettled).toBe(false);

      await profileClient.query('COMMIT');
      profileCommitted = true;
      await restrictionPromise;
      await restrictClient.query('COMMIT');
      restrictCommitted = true;

      const profile = await ownerPool.query<ProfileRow>(
        'SELECT display_name FROM profiles WHERE user_id = $1',
        [userId],
      );
      expect(first(profile).display_name).toBe('Race User');

      const message = await expectRejection(() =>
        ownerPool.query(
          `UPDATE profiles
           SET display_name = 'Must Fail'
           WHERE user_id = $1`,
          [userId],
        ),
      );
      expect(message).toMatch(/Profile write denied: account must be ACTIVE/);
    } finally {
      if (!profileCommitted) await profileClient.query('ROLLBACK').catch(() => undefined);
      if (!restrictCommitted) await restrictClient.query('ROLLBACK').catch(() => undefined);
      profileClient.release();
      restrictClient.release();
      await ownerPool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
  });
});
