/**
 * HASH CHAINING — Blueprint V1.2 §12
 * Propriedade testada: TAMPER-EVIDENT (detecção), não tamper-proof (impossibilidade).
 * O owner do banco AINDA pode reescrever a cadeia inteira — isso é risco residual
 * declarado na V1.2 §12, não um bug destes testes.
 */
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { ownerPool, withRollback, seedAcceptedIntent, closeAll } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string };
type AuditRow = { id: string; prev_hash: string | null; row_hash: string };
type HashRow = { row_hash: string };
type LinkedHashRow = { prev_hash: string; row_hash: string };
type ChainBreakRow = { broken_at: string | number; failure: string };

const first = <T extends QueryResultRow>(result: QueryResult<T>): T => {
  const row = result.rows[0];
  if (!row) throw new Error('Expected database row');
  return row;
};

const insertAudit = (c: PoolClient, action: string): Promise<QueryResult<AuditRow>> =>
  c.query<AuditRow>(
    `INSERT INTO audit_logs (actor_type, action, object_type, reason)
     VALUES ('SYSTEM',$1,'test','unit-test')
     RETURNING id, prev_hash, row_hash`,
    [action],
  );

describe('audit_logs hash chain', () => {
  test('H01 first row gets a row_hash and links from GENESIS', async () => {
    await withRollback(ownerPool, async (c) => {
      const r = await insertAudit(c, 'h01.first');
      expect(first(r).row_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  test('H02 each row prev_hash equals the previous row_hash (deterministic order)', async () => {
    await withRollback(ownerPool, async (c) => {
      const a = await insertAudit(c, 'h02.a');
      const b = await insertAudit(c, 'h02.b');
      const cc = await insertAudit(c, 'h02.c');
      expect(first(b).prev_hash).toBe(first(a).row_hash);
      expect(first(cc).prev_hash).toBe(first(b).row_hash);
    });
  });

  test('H03 row_hash is generated entirely by the trigger (caller never supplies it)', async () => {
    await withRollback(ownerPool, async (c) => {
      const r = await insertAudit(c, 'h03');
      expect(first(r).row_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  test('H04 verify_audit_chain reports no break on an untampered chain', async () => {
    await withRollback(ownerPool, async (c) => {
      await insertAudit(c, 'h04.a');
      await insertAudit(c, 'h04.b');
      const v = await c.query<ChainBreakRow>('SELECT * FROM verify_audit_chain()');
      expect(v.rows).toHaveLength(0);
    });
  });

  test('H05 tampering with a row IS DETECTED by verify_audit_chain', async () => {
    await withRollback(ownerPool, async (c) => {
      await insertAudit(c, 'h05.a');
      const target = await insertAudit(c, 'h05.b');
      await insertAudit(c, 'h05.c');
      const targetRow = first(target);
      await c.query(`UPDATE audit_logs SET action='TAMPERED' WHERE id=$1`, [targetRow.id]);
      const v = await c.query<ChainBreakRow>('SELECT * FROM verify_audit_chain()');
      expect(v.rows.length).toBeGreaterThan(0);
      const broken = first(v);
      expect(Number(broken.broken_at)).toBe(Number(targetRow.id));
      expect(broken.failure).toBe('ROW_HASH_CONTENT_MISMATCH');
    });
  });

  test('H08 tampering with ONLY prev_hash (row_hash left untouched) IS DETECTED', async () => {
    await withRollback(ownerPool, async (c) => {
      await insertAudit(c, 'h08.a');
      const middle = await insertAudit(c, 'h08.b');
      const last = await insertAudit(c, 'h08.c');
      const middleRow = first(middle);
      const lastRow = first(last);

      await c.query(`UPDATE audit_logs SET prev_hash = 'FORGED_PREV_HASH_0000' WHERE id = $1`, [
        middleRow.id,
      ]);

      const v = await c.query<ChainBreakRow>('SELECT * FROM verify_audit_chain()');
      expect(v.rows.length).toBeGreaterThan(0);
      const broken = first(v);
      expect(Number(broken.broken_at)).toBe(Number(middleRow.id));
      expect(broken.failure).toBe('PREV_HASH_LINK_MISMATCH');
      expect(Number(broken.broken_at)).not.toBe(Number(lastRow.id));
    });
  });
});

describe('consent_decisions hash chain', () => {
  test('H06 consent_decisions rows are chained deterministically', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB, intentId } = await seedAcceptedIntent(c);
      const consent = await c.query<IdRow>(
        `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,expires_at)
         VALUES ($1,$2,$3, now() + interval '1 hour') RETURNING id`,
        [intentId, userA, userB],
      );
      const consentRow = first(consent);

      const d1 = await c.query<HashRow>(
        `INSERT INTO consent_decisions (consent_id,acting_user_id,decision,auth_session_ref,request_id,row_hash)
         VALUES ($1,$2,'ACCEPTED','jti-placeholder-1',gen_random_uuid(),'placeholder')
         RETURNING row_hash`,
        [consentRow.id, userB],
      );
      const d2 = await c.query<LinkedHashRow>(
        `INSERT INTO consent_decisions (consent_id,acting_user_id,decision,auth_session_ref,request_id,row_hash)
         VALUES ($1,$2,'ACCEPTED','jti-placeholder-2',gen_random_uuid(),'placeholder')
         RETURNING prev_hash, row_hash`,
        [consentRow.id, userA],
      );

      expect(first(d1).row_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(first(d2).prev_hash).toBe(first(d1).row_hash);
    });
  });

  test('H07 same user cannot record two decisions for the same Consent', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB, intentId } = await seedAcceptedIntent(c);
      const consent = await c.query<IdRow>(
        `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,expires_at)
         VALUES ($1,$2,$3, now() + interval '1 hour') RETURNING id`,
        [intentId, userA, userB],
      );
      const consentRow = first(consent);
      await c.query(
        `INSERT INTO consent_decisions (consent_id,acting_user_id,decision,auth_session_ref,request_id,row_hash)
         VALUES ($1,$2,'ACCEPTED','jti-a',gen_random_uuid(),'placeholder')`,
        [consentRow.id, userA],
      );
      await expect(
        c.query(
          `INSERT INTO consent_decisions (consent_id,acting_user_id,decision,auth_session_ref,request_id,row_hash)
           VALUES ($1,$2,'DECLINED','jti-a2',gen_random_uuid(),'placeholder')`,
          [consentRow.id, userA],
        ),
      ).rejects.toThrow();
    });
  });
});
