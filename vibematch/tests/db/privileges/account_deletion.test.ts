import { Pool } from 'pg';
import { closeAll, expectDbError, ownerPool, rolePools } from '../../helpers/db';

const accountUrl = process.env.DATABASE_URL_ACCOUNT;
if (!accountUrl) throw new Error('Missing required env var: DATABASE_URL_ACCOUNT');
const accountPool = new Pool({ connectionString: accountUrl });

const PERMISSION_DENIED = '42501';
type IdRow = { id: string };
type StatusRow = { status: string };
type RevokedRow = { revoked_at: Date | null };

afterAll(async () => {
  await accountPool.end();
  await closeAll();
});

describe('account deletion least privilege', () => {
  test('svc_account can only request deletion through the constrained function', async () => {
    const user = await ownerPool.query<IdRow>(
      `INSERT INTO users (google_subject_id)
       VALUES ($1)
       RETURNING id`,
      [`delete-${crypto.randomUUID()}`],
    );
    const other = await ownerPool.query<IdRow>(
      `INSERT INTO users (google_subject_id)
       VALUES ($1)
       RETURNING id`,
      [`delete-peer-${crypto.randomUUID()}`],
    );
    const userId = user.rows[0]?.id;
    const otherId = other.rows[0]?.id;
    if (!userId || !otherId) throw new Error('Expected seeded users');

    const session = await ownerPool.query<IdRow>(
      `INSERT INTO auth_sessions (user_id, expires_at)
       VALUES ($1, now() + interval '30 minutes')
       RETURNING id`,
      [userId],
    );
    const sessionId = session.rows[0]?.id;
    if (!sessionId) throw new Error('Expected seeded session');

    const intent = await ownerPool.query<IdRow>(
      `INSERT INTO match_intents (sender_id, receiver_id, expires_at)
       VALUES ($1, $2, now() + interval '1 day')
       RETURNING id`,
      [userId, otherId],
    );
    const intentId = intent.rows[0]?.id;
    if (!intentId) throw new Error('Expected seeded intent');

    const directRead = await expectDbError(accountPool, 'SELECT status FROM users WHERE id = $1', [
      userId,
    ]);
    expect(directRead?.code).toBe(PERMISSION_DENIED);

    const directUpdate = await expectDbError(
      accountPool,
      `UPDATE users SET status = 'PENDING_DELETION' WHERE id = $1`,
      [userId],
    );
    expect(directUpdate?.code).toBe(PERMISSION_DENIED);

    const authExecute = await expectDbError(
      rolePools.svc_auth,
      `SELECT public.request_account_deletion($1::uuid)`,
      [userId],
    );
    expect(authExecute?.code).toBe(PERMISSION_DENIED);

    const requested = await accountPool.query<StatusRow>(
      `SELECT public.request_account_deletion($1::uuid) AS status`,
      [userId],
    );
    expect(requested.rows[0]?.status).toBe('PENDING_DELETION');

    const repeated = await accountPool.query<StatusRow>(
      `SELECT public.request_account_deletion($1::uuid) AS status`,
      [userId],
    );
    expect(repeated.rows[0]?.status).toBe('PENDING_DELETION');

    const status = await ownerPool.query<StatusRow>('SELECT status FROM users WHERE id = $1', [userId]);
    expect(status.rows[0]?.status).toBe('PENDING_DELETION');

    const revoked = await ownerPool.query<RevokedRow>(
      'SELECT revoked_at FROM auth_sessions WHERE id = $1',
      [sessionId],
    );
    expect(revoked.rows[0]?.revoked_at).toBeInstanceOf(Date);

    const cancelled = await ownerPool.query<StatusRow>(
      'SELECT status FROM match_intents WHERE id = $1',
      [intentId],
    );
    expect(cancelled.rows[0]?.status).toBe('CANCELLED');
  });
});
