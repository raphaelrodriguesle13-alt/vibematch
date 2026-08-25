/**
 * SECURITY DEFINER — item 16 do prompt de correção.
 * Runtime roles não devem conseguir chamar diretamente as funções administrativas
 * (verificadores de cadeia de hash), mesmo sendo SECURITY DEFINER e mesmo que o
 * disparo automático via trigger continue funcionando para o próprio domínio.
 */
import { ownerPool, rolePools, expectDbError, closeAll } from '../../helpers/db';

afterAll(closeAll);

const PERMISSION_DENIED = '42501';
type FunctionAclRow = { proname: string; public_execute: boolean };

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
    const err = await expectDbError(rolePools[role], 'SELECT enforce_session_eligibility()');
    expect(err).not.toBeNull();
    expect(err!.code).toBe(PERMISSION_DENIED);
  });
});

describe('PUBLIC has no EXECUTE on administrative functions (catalog check)', () => {
  test('effective ACL contains no PUBLIC execute grant', async () => {
    const r = await ownerPool.query<FunctionAclRow>(`
      SELECT p.proname,
             EXISTS (
               SELECT 1
               FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
               WHERE a.grantee = 0
                 AND a.privilege_type = 'EXECUTE'
             ) AS public_execute
      FROM pg_proc AS p
      WHERE p.proname IN ('verify_audit_chain','verify_consent_decision_chain',
                           'audit_logs_hash_chain','consent_decisions_hash_chain')
    `);

    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) {
      expect(row.public_execute).toBe(false);
    }
  });
});
