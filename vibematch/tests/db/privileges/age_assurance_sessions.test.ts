import { closeAll, ownerPool } from '../../helpers/db';

afterAll(async () => {
  await closeAll();
});

describe('age assurance session privileges', () => {
  it('allows only svc_profile to access provider-session state with column-scoped updates', async () => {
    const result = await ownerPool.query<{
      role_name: string;
      can_select: boolean;
      can_insert: boolean;
      can_update_table: boolean;
      can_update_provider_ref: boolean;
      can_update_verification_url: boolean;
      can_update_status: boolean;
      can_update_updated_at: boolean;
      can_update_user_id: boolean;
      can_update_created_at: boolean;
    }>(
      `SELECT role_name,
              has_table_privilege(role_name, 'age_assurance_sessions', 'SELECT') AS can_select,
              has_table_privilege(role_name, 'age_assurance_sessions', 'INSERT') AS can_insert,
              has_table_privilege(role_name, 'age_assurance_sessions', 'UPDATE') AS can_update_table,
              has_column_privilege(role_name, 'age_assurance_sessions', 'provider_session_ref', 'UPDATE') AS can_update_provider_ref,
              has_column_privilege(role_name, 'age_assurance_sessions', 'verification_url', 'UPDATE') AS can_update_verification_url,
              has_column_privilege(role_name, 'age_assurance_sessions', 'status', 'UPDATE') AS can_update_status,
              has_column_privilege(role_name, 'age_assurance_sessions', 'updated_at', 'UPDATE') AS can_update_updated_at,
              has_column_privilege(role_name, 'age_assurance_sessions', 'user_id', 'UPDATE') AS can_update_user_id,
              has_column_privilege(role_name, 'age_assurance_sessions', 'created_at', 'UPDATE') AS can_update_created_at
       FROM unnest(ARRAY[
         'svc_auth','svc_profile','svc_matchmaking','svc_video','svc_moderation','svc_billing'
       ]) AS role_name
       ORDER BY role_name`,
    );

    for (const row of result.rows) {
      if (row.role_name === 'svc_profile') {
        expect(row.can_select).toBe(true);
        expect(row.can_insert).toBe(true);
        expect(row.can_update_table).toBe(false);
        expect(row.can_update_provider_ref).toBe(true);
        expect(row.can_update_verification_url).toBe(true);
        expect(row.can_update_status).toBe(true);
        expect(row.can_update_updated_at).toBe(true);
        expect(row.can_update_user_id).toBe(false);
        expect(row.can_update_created_at).toBe(false);
      } else {
        expect(row.can_select).toBe(false);
        expect(row.can_insert).toBe(false);
        expect(row.can_update_table).toBe(false);
        expect(row.can_update_provider_ref).toBe(false);
        expect(row.can_update_verification_url).toBe(false);
        expect(row.can_update_status).toBe(false);
        expect(row.can_update_updated_at).toBe(false);
        expect(row.can_update_user_id).toBe(false);
        expect(row.can_update_created_at).toBe(false);
      }
    }
  });
});
