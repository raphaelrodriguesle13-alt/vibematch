import { randomUUID } from 'node:crypto';
import { PgAuthRateLimiter } from '../../../backend/src/auth/rate-limit';
import { closeAll, expectDbError, ownerPool, rolePools } from '../../helpers/db';

afterAll(closeAll);

describe('auth refresh distributed rate limits', () => {
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

  test('non-auth runtime roles cannot write auth throttling state', async () => {
    const error = await expectDbError(
      rolePools.svc_profile,
      `INSERT INTO auth_rate_limits (scope, key_hash, window_started_at, request_count)
       VALUES ('REFRESH', 'GLOBAL', $1, 1)`,
      [new Date('2036-01-01T00:00:00.000Z')],
    );
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });
});
