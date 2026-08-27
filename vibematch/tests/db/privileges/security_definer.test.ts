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

  test.each(roles)(
    '%s CANNOT directly call revoke_auth_sessions_on_account_restriction()',
    async (role) => {
      const err = await expectDbError(
        rolePools[role],
        'SELECT revoke_auth_sessions_on_account_restriction()',
      );
      expect(err).not.toBeNull();
      expect(err!.code).toBe(PERMISSION_DENIED);
    },
  );

  test.each(roles)(
    '%s CANNOT directly call revoke_restricted_state_on_account_restriction()',
    async (role) => {
      const err = await expectDbError(
        rolePools[role],
        'SELECT revoke_restricted_state_on_account_restriction()',
      );
      expect(err).not.toBeNull();
      expect(err!.code).toBe(PERMISSION_DENIED);
    },
  );
});

describe('PUBLIC has no EXECUTE on protected database functions', () => {
  test('effective ACL contains no PUBLIC execute grant', async () => {
    const protectedFunctions = [
      'verify_audit_chain',
      'verify_consent_decision_chain',
      'audit_logs_hash_chain',
      'consent_decisions_hash_chain',
      'enforce_match_intent_phone_verification',
      'enforce_consent_phone_verification',
      'enforce_session_phone_verification',
      'revoke_restricted_state_on_phone_unverified',
      'revoke_restricted_state_on_block',
      'enforce_report_session_membership',
      'enforce_moderation_case_escalation',
      'revoke_auth_sessions_on_account_restriction',
      'enforce_match_intent_active_users',
      'enforce_consent_active_users',
      'revoke_restricted_state_on_account_restriction',
      'enforce_auth_session_active_user',
      'enforce_phone_verification_active_user',
      'enforce_phone_verified_only_for_active_user',
      'enforce_profile_active_user',
      'enforce_user_interest_active_user',
      'enforce_age_assurance_session_active_user',
      'enforce_age_assurance_approval_active_user',
    ];
    const r = await ownerPool.query<FunctionAclRow>(
      `SELECT p.proname,
              EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
                WHERE a.grantee = 0
                  AND a.privilege_type = 'EXECUTE'
              ) AS public_execute
       FROM pg_proc AS p
       WHERE p.proname = ANY($1::text[])
       ORDER BY p.proname`,
      [protectedFunctions],
    );

    expect(new Set(r.rows.map((row) => row.proname))).toEqual(new Set(protectedFunctions));
    for (const row of r.rows) {
      expect(row.public_execute).toBe(false);
    }
  });
});
