import type { QueryResult, QueryResultRow } from 'pg';
import { closeAll, ownerPool, withRollback } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string };
type SessionRow = { id: string; revoked_at: Date | null };

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

const createUserWithTwoSessions = async () => {
  const client = await ownerPool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query<IdRow>(
      `INSERT INTO users (google_subject_id)
       VALUES ($1)
       RETURNING id`,
      [`status-revoke-${Math.random()}`],
    );
    const userId = first(user).id;
    await client.query(
      `INSERT INTO auth_sessions (user_id, expires_at, refresh_token_hash, refresh_expires_at)
       VALUES
         ($1, now() + interval '15 minutes', repeat('a', 64), now() + interval '30 days'),
         ($1, now() + interval '15 minutes', repeat('b', 64), now() + interval '30 days')`,
      [userId],
    );
    return { client, userId };
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }
};

describe('Auth session revocation on account restriction', () => {
  test.each(['SUSPENDED', 'PENDING_DELETION', 'DELETED'])(
    'transition ACTIVE -> %s revokes every outstanding session',
    async (status) => {
      const { client, userId } = await createUserWithTwoSessions();
      try {
        await client.query('UPDATE users SET status = $2 WHERE id = $1', [userId, status]);

        const sessions = await client.query<SessionRow>(
          `SELECT id, revoked_at
           FROM auth_sessions
           WHERE user_id = $1
           ORDER BY id`,
          [userId],
        );
        expect(sessions.rowCount).toBe(2);
        expect(sessions.rows.every((row) => row.revoked_at instanceof Date)).toBe(true);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    },
  );

  test.each(['SUSPENDED', 'PENDING_DELETION', 'DELETED'])(
    '%s account cannot mint a new auth session after restriction',
    async (status) => {
      await withRollback(ownerPool, async (client) => {
        const user = await client.query<IdRow>(
          `INSERT INTO users (google_subject_id, status)
           VALUES ($1, $2)
           RETURNING id`,
          [`status-no-mint-${status}-${Math.random()}`, status],
        );
        const userId = first(user).id;

        const message = await expectRejection(() =>
          client.query(
            `INSERT INTO auth_sessions (user_id, expires_at, refresh_token_hash, refresh_expires_at)
             VALUES ($1, now() + interval '15 minutes', repeat('d', 64), now() + interval '30 days')`,
            [userId],
          ),
        );

        expect(message).toMatch(/account must be ACTIVE/);
      });
    },
  );

  test('ACTIVE account still mints an auth session (control)', async () => {
    await withRollback(ownerPool, async (client) => {
      const user = await client.query<IdRow>(
        `INSERT INTO users (google_subject_id)
         VALUES ($1)
         RETURNING id`,
        [`status-active-mint-${Math.random()}`],
      );
      const session = await client.query<IdRow>(
        `INSERT INTO auth_sessions (user_id, expires_at, refresh_token_hash, refresh_expires_at)
         VALUES ($1, now() + interval '15 minutes', repeat('e', 64), now() + interval '30 days')
         RETURNING id`,
        [first(user).id],
      );
      expect(first(session).id).toBeTruthy();
    });
  });

  test('returning an account to ACTIVE never resurrects revoked sessions', async () => {
    await withRollback(ownerPool, async (client) => {
      const user = await client.query<IdRow>(
        `INSERT INTO users (google_subject_id)
         VALUES ($1)
         RETURNING id`,
        [`status-reactivate-${Math.random()}`],
      );
      const userId = first(user).id;
      await client.query(
        `INSERT INTO auth_sessions (user_id, expires_at, refresh_token_hash, refresh_expires_at)
         VALUES ($1, now() + interval '15 minutes', repeat('c', 64), now() + interval '30 days')`,
        [userId],
      );

      await client.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [userId]);
      await client.query("UPDATE users SET status = 'ACTIVE' WHERE id = $1", [userId]);

      const session = await client.query<SessionRow>(
        'SELECT id, revoked_at FROM auth_sessions WHERE user_id = $1',
        [userId],
      );
      expect(first(session).revoked_at).toBeInstanceOf(Date);
    });
  });
});
