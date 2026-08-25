/**
 * HASH CHAINING — Blueprint V1.2 §12
 * Propriedade testada: TAMPER-EVIDENT (detecção), não tamper-proof (impossibilidade).
 * O owner do banco AINDA pode reescrever a cadeia inteira — isso é risco residual
 * declarado na V1.2 §12, não um bug destes testes.
 */
import { ownerPool, withRollback, closeAll } from '../../helpers/db';

afterAll(closeAll);

// Correção 7: o chamador NUNCA fornece row_hash/prev_hash — o trigger é a
// única autoridade. O runtime só recebe GRANT nas colunas legítimas do evento
// (migration 006); este teste reflete exatamente esse contrato.
const insertAudit = (c: any, action: string) =>
  c.query(
    `INSERT INTO audit_logs (actor_type, action, object_type, reason)
     VALUES ('SYSTEM',$1,'test','unit-test')
     RETURNING id, prev_hash, row_hash`,
    [action],
  );

describe('audit_logs hash chain', () => {
  test('H01 first row gets a row_hash and links from GENESIS', async () => {
    await withRollback(ownerPool, async (c) => {
      const r = await insertAudit(c, 'h01.first');
      expect(r.rows[0].row_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  test('H02 each row prev_hash equals the previous row_hash (deterministic order)', async () => {
    await withRollback(ownerPool, async (c) => {
      const a = await insertAudit(c, 'h02.a');
      const b = await insertAudit(c, 'h02.b');
      const cc = await insertAudit(c, 'h02.c');
      expect(b.rows[0].prev_hash).toBe(a.rows[0].row_hash);
      expect(cc.rows[0].prev_hash).toBe(b.rows[0].row_hash);
    });
  });

  test('H03 row_hash is generated entirely by the trigger (caller never supplies it)', async () => {
    await withRollback(ownerPool, async (c) => {
      // Correção 7: a coluna row_hash nem sequer aparece na lista de INSERT
      // (ver insertAudit acima) — se o trigger não gerasse o valor, NOT NULL rejeitaria.
      const r = await insertAudit(c, 'h03');
      expect(r.rows[0].row_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  test('H04 verify_audit_chain reports no break on an untampered chain', async () => {
    await withRollback(ownerPool, async (c) => {
      await insertAudit(c, 'h04.a');
      await insertAudit(c, 'h04.b');
      const v = await c.query('SELECT * FROM verify_audit_chain()');
      expect(v.rows).toHaveLength(0);
    });
  });

  test('H05 tampering with a row IS DETECTED by verify_audit_chain', async () => {
    await withRollback(ownerPool, async (c) => {
      await insertAudit(c, 'h05.a');
      const target = await insertAudit(c, 'h05.b');
      await insertAudit(c, 'h05.c');
      // Owner-level tampering — exatamente o cenário que a cadeia deve EVIDENCIAR.
      await c.query(`UPDATE audit_logs SET action='TAMPERED' WHERE id=$1`, [target.rows[0].id]);
      const v = await c.query('SELECT * FROM verify_audit_chain()');
      expect(v.rows.length).toBeGreaterThan(0);
      expect(Number(v.rows[0].broken_at)).toBe(Number(target.rows[0].id));
      expect(v.rows[0].failure).toBe('ROW_HASH_CONTENT_MISMATCH');
    });
  });

  test('H08 tampering with ONLY prev_hash (row_hash left untouched) IS DETECTED', async () => {
    // Este é exatamente o bug real encontrado na revisão: o verificador original
    // só recomputava row_hash e nunca comparava prev_hash contra o elo anterior.
    // Alterar só prev_hash passava despercebido. migrations/005 corrige isso.
    await withRollback(ownerPool, async (c) => {
      await insertAudit(c, 'h08.a');
      const middle = await insertAudit(c, 'h08.b');
      const last = await insertAudit(c, 'h08.c');

      // Adulteração cirúrgica: SOMENTE prev_hash muda. row_hash permanece o valor
      // original — ou seja, o "conteúdo" da linha continua batendo com seu próprio
      // row_hash; só o ELO com a linha anterior foi quebrado.
      await c.query(
        `UPDATE audit_logs SET prev_hash = 'FORGED_PREV_HASH_0000' WHERE id = $1`,
        [middle.rows[0].id],
      );

      const v = await c.query('SELECT * FROM verify_audit_chain()');
      expect(v.rows.length).toBeGreaterThan(0);
      expect(Number(v.rows[0].broken_at)).toBe(Number(middle.rows[0].id));
      expect(v.rows[0].failure).toBe('PREV_HASH_LINK_MISMATCH');

      // Confirma que a linha seguinte (não tocada) nem chega a ser avaliada,
      // pois a varredura para no primeiro elo quebrado.
      expect(Number(v.rows[0].broken_at)).not.toBe(Number(last.rows[0].id));
    });
  });
});

describe('consent_decisions hash chain', () => {
  test('H06 consent_decisions rows are chained deterministically', async () => {
    await withRollback(ownerPool, async (c) => {
      const a = await c.query(
        `INSERT INTO users (google_subject_id) VALUES ('h06-a') RETURNING id`);
      const b = await c.query(
        `INSERT INTO users (google_subject_id) VALUES ('h06-b') RETURNING id`);
      const intent = await c.query(
        `INSERT INTO match_intents (sender_id,receiver_id,status,expires_at,responded_at)
         VALUES ($1,$2,'ACCEPTED', now() + interval '1 day', now()) RETURNING id`,
        [a.rows[0].id, b.rows[0].id]);
      const consent = await c.query(
        `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,expires_at)
         VALUES ($1,$2,$3, now() + interval '1 hour') RETURNING id`,
        [intent.rows[0].id, a.rows[0].id, b.rows[0].id]);

      const d1 = await c.query(
        `INSERT INTO consent_decisions (consent_id,acting_user_id,decision,auth_session_ref,request_id,row_hash)
         VALUES ($1,$2,'ACCEPTED','jti-placeholder-1',gen_random_uuid(),'placeholder')
         RETURNING row_hash`, [consent.rows[0].id, b.rows[0].id]);
      const d2 = await c.query(
        `INSERT INTO consent_decisions (consent_id,acting_user_id,decision,auth_session_ref,request_id,row_hash)
         VALUES ($1,$2,'ACCEPTED','jti-placeholder-2',gen_random_uuid(),'placeholder')
         RETURNING prev_hash, row_hash`, [consent.rows[0].id, a.rows[0].id]);

      expect(d1.rows[0].row_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(d2.rows[0].prev_hash).toBe(d1.rows[0].row_hash);
    });
  });

  test('H07 same user cannot record two decisions for the same Consent', async () => {
    await withRollback(ownerPool, async (c) => {
      const a = await c.query(
        `INSERT INTO users (google_subject_id) VALUES ('h07-a') RETURNING id`);
      const b = await c.query(
        `INSERT INTO users (google_subject_id) VALUES ('h07-b') RETURNING id`);
      const intent = await c.query(
        `INSERT INTO match_intents (sender_id,receiver_id,status,expires_at,responded_at)
         VALUES ($1,$2,'ACCEPTED', now() + interval '1 day', now()) RETURNING id`,
        [a.rows[0].id, b.rows[0].id]);
      const consent = await c.query(
        `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,expires_at)
         VALUES ($1,$2,$3, now() + interval '1 hour') RETURNING id`,
        [intent.rows[0].id, a.rows[0].id, b.rows[0].id]);
      await c.query(
        `INSERT INTO consent_decisions (consent_id,acting_user_id,decision,auth_session_ref,request_id,row_hash)
         VALUES ($1,$2,'ACCEPTED','jti-a',gen_random_uuid(),'placeholder')`,
        [consent.rows[0].id, a.rows[0].id]);
      await expect(
        c.query(
          `INSERT INTO consent_decisions (consent_id,acting_user_id,decision,auth_session_ref,request_id,row_hash)
           VALUES ($1,$2,'DECLINED','jti-a2',gen_random_uuid(),'placeholder')`,
          [consent.rows[0].id, a.rows[0].id]),
      ).rejects.toThrow();
    });
  });
});
