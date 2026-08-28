import { randomUUID } from 'node:crypto';
import { PgAuthRateLimiter } from '../../../backend/src/auth/rate-limit';
import { closeAll, expectDbError, ownerPool, rolePools } from '../../helpers/db';

afterAll(closeAll);

describe('auth distributed rate limits', () => {
  test('svc_auth atomically limits one refresh credential without storing the token', async () => {
    const token = `refresh-${randomUUID()}-${randomUUID()}`;
    const limiter = new PgAuthRateLimiter(rolePools.svc_auth, {
      windowSeconds: 60,
      globalLimit: 100,
      credentialLimit: 2,
    });
    const now = new Date('2035-01-01T00:00:10.000Z');

    const first = await limiter.consume('REFRESH', token, now);
    const second = await limiter.consume('REFRESH', token, now);
    const third = await limiter.consume('REFRESH', token, now);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBe(50);

    const rows = await ownerPool.query<{ key_hash: string }>(
      `SELECT key_hash FROM auth_rate_limits
       WHERE scope = 'REFRESH' AND window_started_at = $1`,
      [new Date('2035-01-01T00:00:00.000Z')],
    );
    expect(rows.rows.some((row) => row.key_hash === token)).toBe(false);
    expect(rows.rows.some((row) => /^[0-9a-f]{64}$/.test(row.key_hash))).toBe(true);

    await ownerPool.query(`DELETE FROM auth_rate_limits WHERE window_started_at = $1`, [
      new Date('2035-01-01T00:00:00.000Z'),
    ]);
  });

  test('phone scope is distributed and never stores the user id in cleartext', async () => {
    const limiter = new PgAuthRateLimiter(rolePools.svc_auth, {
      windowSeconds: 60,
      globalLimit: 100,
      credentialLimit: 1,
    });
    const userId = randomUUID();
    const now = new Date('2039-01-01T00:00:10.000Z');

    expect((await limiter.consume('PHONE_START', userId, now)).allowed).toBe(true);
    expect((await limiter.consume('PHONE_START', userId, now)).allowed).toBe(false);

    const window = new Date('2039-01-01T00:00:00.000Z');
    const rows = await ownerPool.query<{ key_hash: string }>(
      `SELECT key_hash FROM auth_rate_limits
       WHERE scope = 'PHONE_START' AND window_started_at = $1`,
      [window],
    );
    expect(rows.rows.some((row) => row.key_hash === userId)).toBe(false);
    expect(rows.rows.some((row) => /^[0-9a-f]{64}$/.test(row.key_hash))).toBe(true);

    await ownerPool.query(`DELETE FROM auth_rate_limits WHERE window_started_at = $1`, [window]);
  });

  test('global ceiling prevents token-spray cardinality growth and old windows are pruned', async () => {
    const limiter = new PgAuthRateLimiter(rolePools.svc_auth, {
      windowSeconds: 60,
      globalLimit: 2,
      credentialLimit: 10,
    });
    const oldWindow = new Date('2036-01-01T00:00:00.000Z');
    await ownerPool.query(
      `INSERT INTO auth_rate_limits (scope, key_hash, window_started_at, request_count)
       VALUES ('REFRESH', 'GLOBAL', $1, 1)`,
      [oldWindow],
    );

    const now = new Date('2036-01-01T00:10:05.000Z');
    expect((await limiter.consume('REFRESH', `token-a-${randomUUID()}`, now)).allowed).toBe(true);
    expect((await limiter.consume('REFRESH', `token-b-${randomUUID()}`, now)).allowed).toBe(true);
    expect((await limiter.consume('REFRESH', `token-c-${randomUUID()}`, now)).allowed).toBe(false);

    const currentWindow = new Date('2036-01-01T00:10:00.000Z');
    const current = await ownerPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM auth_rate_limits
       WHERE scope = 'REFRESH' AND window_started_at = $1`,
      [currentWindow],
    );
    expect(current.rows[0]?.count).toBe('3'); // GLOBAL + only the first two credential fingerprints.

    const old = await ownerPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM auth_rate_limits WHERE window_started_at = $1`,
      [oldWindow],
    );
    expect(old.rows[0]?.count).toBe('0');

    await ownerPool.query(`DELETE FROM auth_rate_limits WHERE window_started_at = $1`, [
      currentWindow,
    ]);
  });

  test('concurrent token spray cannot exceed the global allowance or fingerprint bound', async () => {
    const limiter = new PgAuthRateLimiter(rolePools.svc_auth, {
      windowSeconds: 60,
      globalLimit: 5,
      credentialLimit: 10,
    });
    const now = new Date('2038-01-01T00:00:10.000Z');
    const decisions = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        limiter.consume('LOGOUT_REFRESH', `spray-${index}-${randomUUID()}`, now),
      ),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);

    const currentWindow = new Date('2038-01-01T00:00:00.000Z');
    const rows = await ownerPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM auth_rate_limits
       WHERE scope = 'LOGOUT_REFRESH' AND window_started_at = $1`,
      [currentWindow],
    );
    expect(rows.rows[0]?.count).toBe('6'); // GLOBAL + five admitted credential fingerprints.

    await ownerPool.query(`DELETE FROM auth_rate_limits WHERE window_started_at = $1`, [
      currentWindow,
    ]);
  });

  test('non-auth runtime roles cannot write auth throttling state', async () => {
    const error = await expectDbError(
      rolePools.svc_profile,
      `INSERT INTO auth_rate_limits (scope, key_hash, window_started_at, request_count)
       VALUES ('REFRESH', 'GLOBAL', $1, 1)`,
      [new Date('2037-01-01T00:00:00.000Z')],
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });
});
