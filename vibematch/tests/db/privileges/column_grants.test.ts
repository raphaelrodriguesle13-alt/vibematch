/**
 * COLUMN-LEVEL LEAST PRIVILEGE — correções 1, 2, 3, 4 sobre o Blueprint V1.2 §2.5.
 * Cada role só pode tocar exatamente as colunas do seu domínio.
 */
import type { PoolClient } from 'pg';
import { ownerPool, rolePools, expectDbError, withRollback, closeAll } from '../../helpers/db';

afterAll(closeAll);

const PERMISSION_DENIED = '42501';

type IdRow = { id: string };

const mkUser = async (c: PoolClient, sub: string): Promise<string> => {
  const result = await c.query<IdRow>(
    `INSERT INTO users (google_subject_id) VALUES ($1) RETURNING id`,
    [sub],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Failed to create test user');
  return id;
};

describe('svc_auth — correção 1 (least privilege real)', () => {
  test('svc_auth CAN update phone_verified (its own domain)', async () => {
    await withRollback(ownerPool, async (c) => {
      const id = await mkUser(c, `auth-ok-${Math.random()}`);
      const err = await expectDbError(
        rolePools.svc_auth,
        `UPDATE users SET phone_verified = TRUE WHERE id = $1`,
        [id],
      );
      expect(err === null || err.code !== PERMISSION_DENIED).toBe(true);
    });
  });

  test('svc_auth CANNOT update age_assurance_status (Profile domain)', async () => {
    const err = await expectDbError(
      rolePools.svc_auth,
      `UPDATE users SET age_assurance_status = 'APPROVED' WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_auth CANNOT update status (Moderation domain — suspend/activate)', async () => {
    const err = await expectDbError(
      rolePools.svc_auth,
      `UPDATE users SET status = 'SUSPENDED' WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_auth CAN SELECT status to deny login (read-only)', async () => {
    const err = await expectDbError(rolePools.svc_auth, `SELECT status FROM users LIMIT 1`);
    expect(err).toBeNull();
  });

  test('svc_auth CANNOT write to profiles (Profile domain, correção 2)', async () => {
    const err = await expectDbError(
      rolePools.svc_auth,
      `INSERT INTO profiles (user_id, display_name, language, region)
       VALUES (gen_random_uuid(),'x','pt-BR','BR')`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });
});

describe('svc_profile — correção 2 (novo papel, escopo próprio)', () => {
  test('svc_profile CAN write to profiles (its own domain)', async () => {
    const err = await expectDbError(
      rolePools.svc_profile,
      `UPDATE profiles SET display_name = 'x' WHERE user_id = gen_random_uuid()`,
    );
    expect(err === null || err.code !== PERMISSION_DENIED).toBe(true);
  });

  test('svc_profile CAN update age_assurance_status (orchestrates AgeAssuranceProvider)', async () => {
    const err = await expectDbError(
      rolePools.svc_profile,
      `UPDATE users SET age_assurance_status = 'PENDING' WHERE id = gen_random_uuid()`,
    );
    expect(err === null || err.code !== PERMISSION_DENIED).toBe(true);
  });

  test('svc_profile CANNOT suspend a user (status is Moderation/Auth domain)', async () => {
    const err = await expectDbError(
      rolePools.svc_profile,
      `UPDATE users SET status = 'SUSPENDED' WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_profile CANNOT touch consents', async () => {
    const err = await expectDbError(
      rolePools.svc_profile,
      `UPDATE consents SET status = 'CANCELLED' WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_profile CANNOT touch sessions', async () => {
    const err = await expectDbError(
      rolePools.svc_profile,
      `UPDATE sessions SET status = 'ENDED' WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });
});

describe('svc_moderation — decisions are the only account-restriction write path', () => {
  test('svc_moderation CANNOT directly update users.status', async () => {
    const err = await expectDbError(
      rolePools.svc_moderation,
      `UPDATE users SET status = 'SUSPENDED' WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_moderation CANNOT update users.google_subject_id', async () => {
    const err = await expectDbError(
      rolePools.svc_moderation,
      `UPDATE users SET google_subject_id = 'forged' WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_moderation CANNOT directly cancel a Consent', async () => {
    const err = await expectDbError(
      rolePools.svc_moderation,
      `UPDATE consents SET status='CANCELLED', cancellation_reason='MODERATION'
       WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_moderation CANNOT directly end video sessions', async () => {
    const err = await expectDbError(
      rolePools.svc_moderation,
      `UPDATE sessions SET status='ENDED', end_reason='MODERATION'
       WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_moderation CANNOT change consents.user_a_id', async () => {
    const err = await expectDbError(
      rolePools.svc_moderation,
      `UPDATE consents SET user_a_id = gen_random_uuid() WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_moderation CANNOT change consents.user_b_id', async () => {
    const err = await expectDbError(
      rolePools.svc_moderation,
      `UPDATE consents SET user_b_id = gen_random_uuid() WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_moderation CANNOT change consents.match_intent_id', async () => {
    const err = await expectDbError(
      rolePools.svc_moderation,
      `UPDATE consents SET match_intent_id = gen_random_uuid() WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_moderation CANNOT change consents.user_a_status/user_b_status/accepted_both_at', async () => {
    const err = await expectDbError(
      rolePools.svc_moderation,
      `UPDATE consents SET user_a_status = 'ACCEPTED' WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });
});

describe('svc_matchmaking — correção 4 (colunas estruturais protegidas mesmo sendo o escritor legítimo)', () => {
  test('svc_matchmaking CANNOT UPDATE consents.user_a_id via column-level GRANT', async () => {
    const err = await expectDbError(
      rolePools.svc_matchmaking,
      `UPDATE consents SET user_a_id = gen_random_uuid() WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_matchmaking CANNOT UPDATE consents.match_intent_id via column-level GRANT', async () => {
    const err = await expectDbError(
      rolePools.svc_matchmaking,
      `UPDATE consents SET match_intent_id = gen_random_uuid() WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_matchmaking CANNOT UPDATE consents.created_at via column-level GRANT', async () => {
    const err = await expectDbError(
      rolePools.svc_matchmaking,
      `UPDATE consents SET created_at = now() WHERE id = gen_random_uuid()`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_matchmaking CAN update consents.status (its legitimate transition power)', async () => {
    const err = await expectDbError(
      rolePools.svc_matchmaking,
      `UPDATE consents SET status = 'DECLINED', user_a_status='DECLINED'
       WHERE id = gen_random_uuid()`,
    );
    expect(err === null || err.code !== PERMISSION_DENIED).toBe(true);
  });
});
