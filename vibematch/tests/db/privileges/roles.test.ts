/**
 * SERVICE PRIVILEGE TESTS — Blueprint V1.2 §2.5
 * Cobre diretamente os Release Gates 42, 43 e 44.
 * Executados contra o PostgreSQL real, conectando com cada runtime role.
 */
import { ownerPool, rolePools, expectDbError, closeAll } from '../../helpers/db';

afterAll(closeAll);

const PERMISSION_DENIED = '42501';
const INSUFFICIENT_PRIV = /permission denied|must be owner/i;

describe('GATE 42 — svc_video cannot write to consents', () => {
  test('svc_video CAN SELECT consents', async () => {
    const err = await expectDbError(rolePools.svc_video, 'SELECT id FROM consents LIMIT 1');
    expect(err).toBeNull();
  });

  test('svc_video CANNOT INSERT into consents', async () => {
    const err = await expectDbError(
      rolePools.svc_video,
      `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,expires_at)
       VALUES (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(), now())`,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_video CANNOT UPDATE consents', async () => {
    const err = await expectDbError(
      rolePools.svc_video, `UPDATE consents SET status='ACCEPTED_BOTH'`);
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_video CANNOT DELETE consents', async () => {
    const err = await expectDbError(rolePools.svc_video, 'DELETE FROM consents');
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_video CAN operate on sessions (its own domain)', async () => {
    const err = await expectDbError(rolePools.svc_video, 'SELECT id FROM sessions LIMIT 1');
    expect(err).toBeNull();
  });
});

describe('GATE 43 — runtime roles cannot ALTER/DROP or disable triggers', () => {
  const roles = ['svc_matchmaking', 'svc_video', 'svc_moderation', 'svc_billing'];

  test.each(roles)('%s CANNOT ALTER TABLE consents', async (role) => {
    const err = await expectDbError(
      rolePools[role], 'ALTER TABLE consents ADD COLUMN injected_col TEXT');
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(INSUFFICIENT_PRIV);
  });

  test.each(roles)('%s CANNOT disable the session eligibility trigger', async (role) => {
    const err = await expectDbError(
      rolePools[role], 'ALTER TABLE sessions DISABLE TRIGGER trg_enforce_session_eligibility');
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(INSUFFICIENT_PRIV);
  });

  test.each(roles)('%s CANNOT DROP consents', async (role) => {
    const err = await expectDbError(rolePools[role], 'DROP TABLE consents');
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(INSUFFICIENT_PRIV);
  });

  test.each(roles)('%s is NOT the owner of any application table', async (role) => {
    const res = await ownerPool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner=$1`, [role]);
    expect(res.rows).toHaveLength(0);
  });
});

describe('GATE 44 — audit_logs is INSERT-only for runtime roles', () => {
  test('TEST A — runtime CAN INSERT into audit_logs', async () => {
    const err = await expectDbError(
      rolePools.svc_moderation,
      `INSERT INTO audit_logs (actor_type, action, object_type, row_hash)
       VALUES ('SYSTEM','gate44.probe','test','placeholder')`,
    );
    expect(err).toBeNull();
  });

  test('TEST B — runtime CANNOT UPDATE audit_logs', async () => {
    const err = await expectDbError(
      rolePools.svc_moderation, `UPDATE audit_logs SET action='tampered'`);
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('TEST C — runtime CANNOT DELETE audit_logs', async () => {
    const err = await expectDbError(rolePools.svc_moderation, 'DELETE FROM audit_logs');
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('TEST D — runtime CANNOT ALTER audit_logs', async () => {
    const err = await expectDbError(
      rolePools.svc_moderation, 'ALTER TABLE audit_logs DROP COLUMN row_hash');
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(INSUFFICIENT_PRIV);
  });
});

describe('Cross-domain isolation', () => {
  test('svc_billing CANNOT write to sessions', async () => {
    const err = await expectDbError(
      rolePools.svc_billing, `UPDATE sessions SET status='ENDED'`);
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test('svc_matchmaking CANNOT write to subscriptions', async () => {
    const err = await expectDbError(
      rolePools.svc_matchmaking, `UPDATE subscriptions SET status='ACTIVE'`);
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });
});
