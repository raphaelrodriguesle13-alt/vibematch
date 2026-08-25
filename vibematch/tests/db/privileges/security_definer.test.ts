/**
 * SECURITY DEFINER — item 16 do prompt de correção.
 * Runtime roles não devem conseguir chamar diretamente as funções administrativas
 * (verificadores de cadeia de hash), mesmo sendo SECURITY DEFINER e mesmo que o
 * disparo automático via trigger continue funcionando para o próprio domínio.
 */
import { ownerPool, rolePools, expectDbError, closeAll } from '../../helpers/db';

afterAll(closeAll);

const PERMISSION_DENIED = '42501';

describe('Direct invocation of administrative SECURITY DEFINER functions is denied', () => {
  const roles = [
    'svc_auth',
    'svc_profile',
    'svc_matchmaking',
    'svc_video',
    'svc_moderation',
    'svc_billing',
  ] as const;

  test.each(roles)('%s CANNOT directly call verify_audit_chain()', async (role) => {
    const err = await expectDbError(rolePools[role], 'SELECT * FROM verify_audit_chain()');
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test.each(roles)('%s CANNOT directly call verify_consent_decision_chain()', async (role) => {
    const err = await expectDbError(
      rolePools[role],
      'SELECT * FROM verify_consent_decision_chain()',
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });

  test.each(roles)('%s CANNOT directly call enforce_session_eligibility()', async (role) => {
    // Chamada direta (não via trigger) — deve ser negada por falta de EXECUTE,
    // mesmo sendo uma função de trigger comum (não SECURITY DEFINER).
    const err = await expectDbError(rolePools[role], 'SELECT enforce_session_eligibility()');
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });
});

describe('PUBLIC has no EXECUTE on administrative functions (catalog check)', () => {
  test('pg_proc/pg_catalog shows no ACL entry granting PUBLIC execute', async () => {
    const r = await ownerPool.query(`
      SELECT proname, proacl::text AS acl
      FROM pg_proc
      WHERE proname IN ('verify_audit_chain','verify_consent_decision_chain',
                         'audit_logs_hash_chain','consent_decisions_hash_chain')
    `);
    for (const row of r.rows) {
      // proacl NULL significa "privilégios default do dono" (sem PUBLIC implícito
      // após REVOKE); se não for NULL, não deve conter "=X/" (a notação de PUBLIC).
      if (row.acl !== null) {
        expect(row.acl).not.toMatch(/=[a-zA-Z]*X\//);
      }
    }
  });
});
