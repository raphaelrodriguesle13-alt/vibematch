/**
 * CONSENT STRUCTURAL IMMUTABILITY — correção 4 / item 15 do prompt de correção.
 * Testa o trigger enforce_consent_structural_immutability diretamente, inclusive
 * como OWNER (defesa em profundidade: a invariante não deve depender só do GRANT).
 */
import type { PoolClient, QueryResult } from 'pg';
import { ownerPool, withRollback, seedAcceptedIntent, closeAll } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string };
type StatusRow = { status: string };
type ConsentSeed = { consentId: string; userA: string; userB: string; intentId: string };

const first = <T extends Record<string, unknown>>(result: QueryResult<T>): T => {
  const row = result.rows[0];
  if (!row) throw new Error('Expected database row');
  return row;
};

const expectRejection = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    throw new Error('EXPECTED REJECTION BUT STATEMENT SUCCEEDED');
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'EXPECTED REJECTION BUT STATEMENT SUCCEEDED') throw e;
    return msg;
  }
};

describe('Consent structural immutability (trigger, defense-in-depth)', () => {
  const mkConsent = async (c: PoolClient): Promise<ConsentSeed> => {
    const { userA, userB, intentId } = await seedAcceptedIntent(c);
    const r = await c.query<IdRow>(
      `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,expires_at)
       VALUES ($1,$2,$3, now() + interval '1 hour') RETURNING id`,
      [intentId, userA, userB],
    );
    return { consentId: first(r).id, userA, userB, intentId };
  };

  test('SI01 user_a_id cannot be changed after INSERT', async () => {
    await withRollback(ownerPool, async (c) => {
      const { consentId } = await mkConsent(c);
      const msg = await expectRejection(() =>
        c.query(`UPDATE consents SET user_a_id = gen_random_uuid() WHERE id=$1`, [consentId]),
      );
      expect(msg).toMatch(/structural field is immutable: user_a_id/);
    });
  });

  test('SI02 user_b_id cannot be changed after INSERT', async () => {
    await withRollback(ownerPool, async (c) => {
      const { consentId } = await mkConsent(c);
      const msg = await expectRejection(() =>
        c.query(`UPDATE consents SET user_b_id = gen_random_uuid() WHERE id=$1`, [consentId]),
      );
      expect(msg).toMatch(/structural field is immutable: user_b_id/);
    });
  });

  test('SI03 match_intent_id cannot be changed after INSERT', async () => {
    await withRollback(ownerPool, async (c) => {
      const { consentId } = await mkConsent(c);
      const msg = await expectRejection(() =>
        c.query(`UPDATE consents SET match_intent_id = gen_random_uuid() WHERE id=$1`, [consentId]),
      );
      expect(msg).toMatch(/structural field is immutable: match_intent_id/);
    });
  });

  test('SI04 created_at cannot be changed after INSERT', async () => {
    await withRollback(ownerPool, async (c) => {
      const { consentId } = await mkConsent(c);
      const msg = await expectRejection(() =>
        c.query(`UPDATE consents SET created_at = now() - interval '1 day' WHERE id=$1`, [
          consentId,
        ]),
      );
      expect(msg).toMatch(/structural field is immutable: created_at/);
    });
  });

  test('SI05 id cannot be changed after INSERT', async () => {
    await withRollback(ownerPool, async (c) => {
      const { consentId } = await mkConsent(c);
      const msg = await expectRejection(() =>
        c.query(`UPDATE consents SET id = gen_random_uuid() WHERE id=$1`, [consentId]),
      );
      expect(msg).toMatch(/structural field is immutable: id/);
    });
  });

  test('SI06 a legitimate, non-structural UPDATE still works (control test)', async () => {
    await withRollback(ownerPool, async (c) => {
      const { consentId } = await mkConsent(c);
      const r = await c.query<StatusRow>(
        `UPDATE consents SET status='DECLINED', user_a_status='DECLINED' WHERE id=$1 RETURNING status`,
        [consentId],
      );
      expect(first(r).status).toBe('DECLINED');
    });
  });
});

describe('Consent ↔ MatchIntent rejection matrix (item 14 do prompt)', () => {
  const seedVerifiedPair = async (c: PoolClient, prefix: string) => {
    const a = await c.query<IdRow>(
      `INSERT INTO users (google_subject_id, phone_verified) VALUES ($1, TRUE) RETURNING id`,
      [`${prefix}-a`],
    );
    const b = await c.query<IdRow>(
      `INSERT INTO users (google_subject_id, phone_verified) VALUES ($1, TRUE) RETURNING id`,
      [`${prefix}-b`],
    );
    return { aRow: first(a), bRow: first(b) };
  };

  test('CM01 Consent for a SENT (not yet ACCEPTED) MatchIntent is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const { aRow, bRow } = await seedVerifiedPair(c, 'cm01');
      const sent = await c.query<IdRow>(
        `INSERT INTO match_intents (sender_id,receiver_id,expires_at) VALUES ($1,$2, now() + interval '1 day') RETURNING id`,
        [aRow.id, bRow.id],
      );
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,expires_at) VALUES ($1,$2,$3, now() + interval '1 hour')`,
          [first(sent).id, aRow.id, bRow.id],
        ),
      );
      expect(msg).toMatch(/requires an ACCEPTED MatchIntent/);
    });
  });

  test('CM02 Consent for a DECLINED MatchIntent is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const { aRow, bRow } = await seedVerifiedPair(c, 'cm02');
      const declined = await c.query<IdRow>(
        `INSERT INTO match_intents (sender_id,receiver_id,status,expires_at,responded_at) VALUES ($1,$2,'DECLINED', now() + interval '1 day', now()) RETURNING id`,
        [aRow.id, bRow.id],
      );
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,expires_at) VALUES ($1,$2,$3, now() + interval '1 hour')`,
          [first(declined).id, aRow.id, bRow.id],
        ),
      );
      expect(msg).toMatch(/requires an ACCEPTED MatchIntent/);
    });
  });

  test('CM03 Consent for an EXPIRED MatchIntent is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const { aRow, bRow } = await seedVerifiedPair(c, 'cm03');
      const expired = await c.query<IdRow>(
        `INSERT INTO match_intents (sender_id,receiver_id,status,expires_at,closed_at) VALUES ($1,$2,'EXPIRED', now() - interval '1 hour', now()) RETURNING id`,
        [aRow.id, bRow.id],
      );
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,expires_at) VALUES ($1,$2,$3, now() + interval '1 hour')`,
          [first(expired).id, aRow.id, bRow.id],
        ),
      );
      expect(msg).toMatch(/requires an ACCEPTED MatchIntent/);
    });
  });
});
