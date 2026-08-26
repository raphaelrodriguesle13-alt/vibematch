import { closeAll, ownerPool } from '../../helpers/db';

afterAll(async () => {
  await closeAll();
});

describe('age assurance session privileges', () => {
  it('allows only svc_profile to access provider-session state', async () => {
    const result = await ownerPool.query<{
      role_name: string;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
    }>(
      `SELECT role_name,
              has_table_privilege(role_name, 'age_assurance_sessions', 'SELECT') AS can_select,
              has_table_privilege(role_name, 'age_assurance_sessions', 'INSERT') AS can_insert,
              has_table_privilege(role_name, 'age_assurance_sessions', 'UPDATE') AS can_update
       FROM unnest(ARRAY[
         'svc_auth','svc_profile','svc_matchmaking','svc_video','svc_moderation','svc_billing'
       ]) AS role_name
       ORDER BY role_name`,
    );

    for (const row of result.rows) {
      if (row.role_name === 'svc_profile') {
        expect(row.can_select).toBe(true);
        expect(row.can_insert).toBe(true);
        expect(row.can_update).toBe(true);
      } else {
        expect(row.can_select).toBe(false);
        expect(row.can_insert).toBe(false);
        expect(row.can_update).toBe(false);
      }
    }
  });
});
