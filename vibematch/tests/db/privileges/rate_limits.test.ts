import type { Pool } from 'pg';
import { closeAll, expectDbError, ownerPool, rolePools } from '../../helpers/db';

afterAll(closeAll);

const PERMISSION_DENIED = '42501';

const consume = async (
  pool: Pool,
  table: 'matchmaking_rate_limits' | 'video_rate_limits',
  userId: string,
  scope: string,
  now: Date,
  limit: number,
): Promise<boolean> => {
  const result = await pool.query(
    `INSERT INTO ${table} (user_id, scope, window_started_at, request_count)
     VALUES ($1, $2, date_trunc('minute', $3::timestamptz), 1)
     ON CONFLICT (user_id, scope, window_started_at)
     DO UPDATE SET request_count = ${table}.request_count + 1
     WHERE ${table}.request_count < $4
     RETURNING request_count`,
    [userId, scope, now, limit],
  );
  return (result.rowCount ?? 0) === 1;
};

describe('Restricted rate-limit persistence and least privilege', () => {
  let userId: string;

  beforeAll(async () => {
    const result = await ownerPool.query<{ id: string }>(
      `INSERT INTO users (google_subject_id, phone_verified, age_assurance_status)
       VALUES ($1, TRUE, 'APPROVED') RETURNING id`,
      [`rate-limit-${Math.random()}`],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Failed to seed rate limit user');
    userId = row.id;
  });

  afterAll(async () => {
    if (userId) await ownerPool.query('DELETE FROM users WHERE id = $1', [userId]);
  });

  test('svc_matchmaking atomically rejects the 31st consent decision in one minute', async () => {
    const now = new Date('2026-08-26T16:30:10.000Z');
    for (let i = 0; i < 30; i += 1) {
      await expect(
        consume(
          rolePools.svc_matchmaking,
          'matchmaking_rate_limits',
          userId,
          'CONSENT_DECISION',
          now,
          30,
        ),
      ).resolves.toBe(true);
    }
    await expect(
      consume(
        rolePools.svc_matchmaking,
        'matchmaking_rate_limits',
        userId,
        'CONSENT_DECISION',
        now,
        30,
      ),
    ).resolves.toBe(false);
  });

  test('svc_video atomically rejects the 31st token request in one minute', async () => {
    const now = new Date('2026-08-26T16:31:10.000Z');
    for (let i = 0; i < 30; i += 1) {
      await expect(
        consume(rolePools.svc_video, 'video_rate_limits', userId, 'TOKEN', now, 30),
      ).resolves.toBe(true);
    }
    await expect(
      consume(rolePools.svc_video, 'video_rate_limits', userId, 'TOKEN', now, 30),
    ).resolves.toBe(false);
  });

  test('rate-limit tables are isolated between runtime roles', async () => {
    const now = new Date('2026-08-26T16:32:00.000Z');
    const matchmakingToVideo = await expectDbError(
      rolePools.svc_matchmaking,
      `INSERT INTO video_rate_limits (user_id, scope, window_started_at, request_count)
       VALUES ($1, 'TOKEN', $2, 1)`,
      [userId, now],
    );
    expect(matchmakingToVideo?.code).toBe(PERMISSION_DENIED);

    const videoToMatchmaking = await expectDbError(
      rolePools.svc_video,
      `INSERT INTO matchmaking_rate_limits (user_id, scope, window_started_at, request_count)
       VALUES ($1, 'CONSENT_DECISION', $2, 1)`,
      [userId, now],
    );
    expect(videoToMatchmaking?.code).toBe(PERMISSION_DENIED);
  });
});
