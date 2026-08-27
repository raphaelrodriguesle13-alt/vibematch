import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { closeAll, ownerPool, rolePools } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string } & QueryResultRow;
type UserStateRow = { status: string } & QueryResultRow;
type SessionStateRow = { revoked_at: Date | null } & QueryResultRow;
type CaseStateRow = { decision: string | null; decided_at: Date | null } & QueryResultRow;

const first = <T extends QueryResultRow>(result: QueryResult<T>): T => {
  const row = result.rows[0];
  if (!row) throw new Error('Expected database row');
  return row;
};

const createUser = async (client: PoolClient, prefix: string): Promise<string> => {
  const result = await client.query<IdRow>(
    `INSERT INTO users (google_subject_id)
     VALUES ($1)
     RETURNING id`,
    [`${prefix}-${randomUUID()}`],
  );
  return first(result).id;
};

const createCase = async (
  client: PoolClient,
): Promise<{ reporterId: string; reportedId: string; caseId: string; sessionId: string }> => {
  const reporterId = await createUser(client, 'moderation-reporter');
  const reportedId = await createUser(client, 'moderation-reported');
  const report = await client.query<IdRow>(
    `INSERT INTO reports (reporter_id, reported_id, category, severity)
     VALUES ($1, $2, 'OTHER', 'LOW')
     RETURNING id`,
    [reporterId, reportedId],
  );
  const moderationCase = await client.query<IdRow>(
    `INSERT INTO moderation_cases (report_id, requires_human)
     VALUES ($1, FALSE)
     RETURNING id`,
    [first(report).id],
  );
  const session = await client.query<IdRow>(
    `INSERT INTO auth_sessions (user_id, expires_at)
     VALUES ($1, clock_timestamp() + interval '1 hour')
     RETURNING id`,
    [reportedId],
  );

  return {
    reporterId,
    reportedId,
    caseId: first(moderationCase).id,
    sessionId: first(session).id,
  };
};

const cleanup = async (ids: {
  reporterId: string;
  reportedId: string;
  caseId: string;
}): Promise<void> => {
  await ownerPool.query('DELETE FROM moderation_cases WHERE id = $1', [ids.caseId]);
  await ownerPool.query('DELETE FROM reports WHERE reporter_id = $1 AND reported_id = $2', [
    ids.reporterId,
    ids.reportedId,
  ]);
  await ownerPool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
    [ids.reporterId, ids.reportedId],
  ]);
};

describe('Restrictive moderation decisions', () => {
  test.each(['SUSPENSION', 'BAN'])(
    '%s atomically restricts the reported account and revokes its auth sessions',
    async (decision) => {
      const setup = await ownerPool.connect();
      let ids: Awaited<ReturnType<typeof createCase>> | null = null;
      try {
        ids = await createCase(setup);
      } finally {
        setup.release();
      }

      try {
        await rolePools.svc_moderation.query(
          `UPDATE moderation_cases
              SET decision = $2,
                  decided_at = clock_timestamp()
            WHERE id = $1`,
          [ids.caseId, decision],
        );

        const user = first(
          await ownerPool.query<UserStateRow>('SELECT status FROM users WHERE id = $1', [
            ids.reportedId,
          ]),
        );
        expect(user.status).toBe('SUSPENDED');

        const session = first(
          await ownerPool.query<SessionStateRow>(
            'SELECT revoked_at FROM auth_sessions WHERE id = $1',
            [ids.sessionId],
          ),
        );
        expect(session.revoked_at).not.toBeNull();

        const report = first(
          await ownerPool.query<{ status: string } & QueryResultRow>(
            `SELECT r.status
               FROM reports AS r
               JOIN moderation_cases AS mc ON mc.report_id = r.id
              WHERE mc.id = $1`,
            [ids.caseId],
          ),
        );
        expect(report.status).toBe('RESOLVED');
      } finally {
        await cleanup(ids);
      }
    },
  );

  test('rolling back a moderation decision also rolls back account/session revocation', async () => {
    const client = await ownerPool.connect();
    let ids: Awaited<ReturnType<typeof createCase>> | null = null;
    try {
      ids = await createCase(client);
      await client.query('BEGIN');
      await client.query(
        `UPDATE moderation_cases
            SET decision = 'SUSPENSION',
                decided_at = clock_timestamp()
          WHERE id = $1`,
        [ids.caseId],
      );

      expect(
        first(await client.query<UserStateRow>('SELECT status FROM users WHERE id = $1', [ids.reportedId]))
          .status,
      ).toBe('SUSPENDED');
      expect(
        first(
          await client.query<SessionStateRow>('SELECT revoked_at FROM auth_sessions WHERE id = $1', [
            ids.sessionId,
          ]),
        ).revoked_at,
      ).not.toBeNull();

      await client.query('ROLLBACK');

      expect(
        first(await client.query<UserStateRow>('SELECT status FROM users WHERE id = $1', [ids.reportedId]))
          .status,
      ).toBe('ACTIVE');
      expect(
        first(
          await client.query<SessionStateRow>('SELECT revoked_at FROM auth_sessions WHERE id = $1', [
            ids.sessionId,
          ]),
        ).revoked_at,
      ).toBeNull();
      const moderationCase = first(
        await client.query<CaseStateRow>(
          'SELECT decision, decided_at FROM moderation_cases WHERE id = $1',
          [ids.caseId],
        ),
      );
      expect(moderationCase).toMatchObject({ decision: null, decided_at: null });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      if (ids) await cleanup(ids);
    }
  });
});
