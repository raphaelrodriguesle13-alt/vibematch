import { ownerPool, rolePools, expectDbError, closeAll } from '../../helpers/db';

afterAll(closeAll);

const PERMISSION_DENIED = '42501';
type IdRow = { id: string };

const createCommittedUser = async (): Promise<string> => {
  const result = await ownerPool.query<IdRow>(
    `INSERT INTO users (google_subject_id)
     VALUES ($1)
     RETURNING id`,
    [`auth-priv-${crypto.randomUUID()}`],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Expected seeded user');
  return row.id;
};

describe('Auth persistence least privilege', () => {
  test('svc_auth CAN create and revoke an auth_session', async () => {
    const userId = await createCommittedUser();
    const inserted = await rolePools.svc_auth.query<IdRow>(
      `INSERT INTO auth_sessions (user_id, expires_at)
       VALUES ($1, now() + interval '30 minutes')
       RETURNING id`,
      [userId],
    );
    const session = inserted.rows[0];
    expect(session).toBeDefined();

    const err = await expectDbError(
      rolePools.svc_auth,
      `UPDATE auth_sessions SET revoked_at = now() WHERE id = $1`,
      [session!.id],
    );
    expect(err).toBeNull();
  });

  test.each([
    'svc_profile',
    'svc_matchmaking',
    'svc_video',
    'svc_moderation',
    'svc_billing',
  ] as const)('%s CANNOT read auth_sessions', async (role) => {
    const err = await expectDbError(rolePools[role], 'SELECT id FROM auth_sessions LIMIT 1');
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test.each([
    'svc_profile',
    'svc_matchmaking',
    'svc_video',
    'svc_moderation',
    'svc_billing',
  ] as const)('%s CANNOT create auth_sessions', async (role) => {
    const err = await expectDbError(
      rolePools[role],
      `INSERT INTO auth_sessions (user_id, expires_at)
       VALUES (gen_random_uuid(), now() + interval '30 minutes')`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_auth CAN create and consume phone_verifications without storing the code', async () => {
    const userId = await createCommittedUser();
    const inserted = await rolePools.svc_auth.query<IdRow>(
      `INSERT INTO phone_verifications
         (user_id, provider_verification_id, phone_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '10 minutes')
       RETURNING id`,
      [userId, `provider-${crypto.randomUUID()}`, 'synthetic-phone-hash'],
    );
    const verification = inserted.rows[0];
    expect(verification).toBeDefined();

    const err = await expectDbError(
      rolePools.svc_auth,
      `UPDATE phone_verifications
       SET consumed_at = now(), attempts = attempts + 1
       WHERE id = $1`,
      [verification!.id],
    );
    expect(err).toBeNull();
  });

  test.each([
    'svc_profile',
    'svc_matchmaking',
    'svc_video',
    'svc_moderation',
    'svc_billing',
  ] as const)('%s CANNOT read phone_verifications', async (role) => {
    const err = await expectDbError(
      rolePools[role],
      'SELECT id FROM phone_verifications LIMIT 1',
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });
});
