/**
 * NEGATIVE DATABASE TEST SUITE — Blueprint V1.2 §2.2/§2.3/§13
 *
 * Estes testes tentam DELIBERADAMENTE criar estados proibidos.
 * Cada teste declara EXPECTED e ACTUAL. Sucesso = o PostgreSQL rejeitar.
 * Nenhuma invariante crítica é validada apenas na camada de aplicação.
 */
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { ownerPool, withRollback, seedAcceptedIntent, closeAll } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string };
type ConsentStateRow = {
  user_a_status: string;
  user_b_status: string;
  status: string;
};
type SessionRow = { id: string; status: string };

type ConsentSeed = {
  consentId: string;
  userA: string;
  userB: string;
};

const first = <T extends QueryResultRow>(result: QueryResult<T>): T => {
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

describe('MATCH_INTENT invariants', () => {
  test('N01 self MatchIntent is rejected (chk_no_self_intent)', async () => {
    await withRollback(ownerPool, async (c) => {
      const u = await c.query<IdRow>(
        `INSERT INTO users (google_subject_id) VALUES ('n01') RETURNING id`,
      );
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO match_intents (sender_id, receiver_id, expires_at)
           VALUES ($1,$1, now() + interval '1 day')`,
          [first(u).id],
        ),
      );
      expect(msg).toMatch(/chk_no_self_intent/);
    });
  });

  test('N02 ACCEPTED without responded_at is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB } = await seedAcceptedIntent(c);
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO match_intents (sender_id, receiver_id, status, expires_at)
           VALUES ($1,$2,'ACCEPTED', now() + interval '1 day')`,
          [userB, userA],
        ),
      );
      expect(msg).toMatch(/chk_intent_status_timestamps/);
    });
  });

  test('N03 EXPIRED faking a human response (responded_at set) is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB } = await seedAcceptedIntent(c);
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO match_intents (sender_id, receiver_id, status, expires_at, responded_at)
           VALUES ($1,$2,'EXPIRED', now() + interval '1 day', now())`,
          [userB, userA],
        ),
      );
      expect(msg).toMatch(/chk_intent_status_timestamps/);
    });
  });

  test('N04 SENT with terminal timestamp is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB } = await seedAcceptedIntent(c);
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO match_intents (sender_id, receiver_id, status, expires_at, closed_at)
           VALUES ($1,$2,'SENT', now() + interval '1 day', now())`,
          [userB, userA],
        ),
      );
      expect(msg).toMatch(/chk_intent_status_timestamps/);
    });
  });
});

describe('CONSENT invariants (V1.2 §2.3)', () => {
  test('N05 PENDING with ACCEPTED/ACCEPTED is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB, intentId } = await seedAcceptedIntent(c);
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,user_a_status,user_b_status,status,expires_at)
           VALUES ($1,$2,$3,'ACCEPTED','ACCEPTED','PENDING', now() + interval '1 hour')`,
          [intentId, userA, userB],
        ),
      );
      expect(msg).toMatch(/chk_accepted_both_iff_both_accepted|chk_pending_has_no_terminal_substatus/);
    });
  });

  test('N06 ACCEPTED_BOTH without both ACCEPTED is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB, intentId } = await seedAcceptedIntent(c);
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,user_a_status,user_b_status,status,accepted_both_at,expires_at)
           VALUES ($1,$2,$3,'ACCEPTED','PENDING','ACCEPTED_BOTH', now(), now() + interval '1 hour')`,
          [intentId, userA, userB],
        ),
      );
      expect(msg).toMatch(/chk_accepted_both_iff_both_accepted/);
    });
  });

  test('N07 DECLINED without any DECLINED sub-status is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB, intentId } = await seedAcceptedIntent(c);
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,user_a_status,user_b_status,status,expires_at)
           VALUES ($1,$2,$3,'ACCEPTED','PENDING','DECLINED', now() + interval '1 hour')`,
          [intentId, userA, userB],
        ),
      );
      expect(msg).toMatch(/chk_declined_requires_a_decline/);
    });
  });

  test('N08 CANCELLED without cancellation_reason is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB, intentId } = await seedAcceptedIntent(c);
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,status,expires_at)
           VALUES ($1,$2,$3,'CANCELLED', now() + interval '1 hour')`,
          [intentId, userA, userB],
        ),
      );
      expect(msg).toMatch(/chk_cancelled_requires_reason/);
    });
  });

  test('N09 CANCELLED PRESERVES factual history (ACCEPTED sub-status kept)', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB, intentId } = await seedAcceptedIntent(c);
      const r = await c.query<IdRow>(
        `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,user_a_status,user_b_status,status,accepted_both_at,expires_at)
         VALUES ($1,$2,$3,'ACCEPTED','ACCEPTED','ACCEPTED_BOTH', now(), now() + interval '1 hour') RETURNING id`,
        [intentId, userA, userB],
      );
      const id = first(r).id;
      await c.query(
        `UPDATE consents SET status='CANCELLED', cancellation_reason='BLOCK' WHERE id=$1`,
        [id],
      );
      const after = await c.query<ConsentStateRow>(
        `SELECT user_a_status, user_b_status, status FROM consents WHERE id=$1`,
        [id],
      );
      const row = first(after);
      expect(row.user_a_status).toBe('ACCEPTED');
      expect(row.user_b_status).toBe('ACCEPTED');
      expect(row.status).toBe('CANCELLED');
    });
  });

  test('N10 terminal Consent cannot be reopened', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB, intentId } = await seedAcceptedIntent(c);
      const r = await c.query<IdRow>(
        `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,user_a_status,status,expires_at)
         VALUES ($1,$2,$3,'DECLINED','DECLINED', now() + interval '1 hour') RETURNING id`,
        [intentId, userA, userB],
      );
      const msg = await expectRejection(() =>
        c.query(`UPDATE consents SET status='PENDING', user_a_status='PENDING' WHERE id=$1`, [first(r).id]),
      );
      expect(msg).toMatch(/terminal/i);
    });
  });

  test('N11 ACCEPTED sub-status cannot revert to PENDING', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB, intentId } = await seedAcceptedIntent(c);
      const r = await c.query<IdRow>(
        `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,user_a_status,expires_at)
         VALUES ($1,$2,$3,'ACCEPTED', now() + interval '1 hour') RETURNING id`,
        [intentId, userA, userB],
      );
      const msg = await expectRejection(() =>
        c.query(`UPDATE consents SET user_a_status='PENDING' WHERE id=$1`, [first(r).id]),
      );
      expect(msg).toMatch(/Cannot revert user_a_status/);
    });
  });

  test('N12 Consent for non-existent MatchIntent is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB } = await seedAcceptedIntent(c);
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,expires_at)
           VALUES (gen_random_uuid(),$1,$2, now() + interval '1 hour')`,
          [userA, userB],
        ),
      );
      expect(msg).toMatch(/not found|violates foreign key/i);
    });
  });

  test('N13 Consent for non-ACCEPTED MatchIntent is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB } = await seedAcceptedIntent(c);
      const sent = await c.query<IdRow>(
        `INSERT INTO match_intents (sender_id,receiver_id,expires_at)
         VALUES ($1,$2, now() + interval '1 day') RETURNING id`,
        [userB, userA],
      );
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,expires_at)
           VALUES ($1,$2,$3, now() + interval '1 hour')`,
          [first(sent).id, userA, userB],
        ),
      );
      expect(msg).toMatch(/requires an ACCEPTED MatchIntent/);
    });
  });

  test('N14 Consent with users different from MatchIntent participants is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, intentId } = await seedAcceptedIntent(c);
      const stranger = await c.query<IdRow>(
        `INSERT INTO users (google_subject_id) VALUES ('n14-stranger') RETURNING id`,
      );
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,expires_at)
           VALUES ($1,$2,$3, now() + interval '1 hour')`,
          [intentId, userA, first(stranger).id],
        ),
      );
      expect(msg).toMatch(/do not match MatchIntent participants/);
    });
  });
});

describe('SESSION eligibility (V1.2 §2.2 trigger)', () => {
  const mkConsent = async (c: PoolClient, status: string): Promise<ConsentSeed> => {
    const { userA, userB, intentId } = await seedAcceptedIntent(c);
    const sub = status === 'ACCEPTED_BOTH' ? `'ACCEPTED','ACCEPTED'` : `'PENDING','PENDING'`;
    const r = await c.query<IdRow>(
      `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,user_a_status,user_b_status,status,
                             accepted_both_at, video_deadline, expires_at)
       VALUES ($1,$2,$3,${sub},$4,
               CASE WHEN $4='ACCEPTED_BOTH' THEN now() ELSE NULL END,
               CASE WHEN $4='ACCEPTED_BOTH' THEN now() + interval '1 hour' ELSE NULL END,
               now() + interval '1 hour') RETURNING id`,
      [intentId, userA, userB, status],
    );
    return { consentId: first(r).id, userA, userB };
  };

  test('S01 Session rejected when Consent is not ACCEPTED_BOTH', async () => {
    await withRollback(ownerPool, async (c) => {
      const { consentId } = await mkConsent(c, 'PENDING');
      const msg = await expectRejection(() =>
        c.query(`INSERT INTO sessions (consent_id, livekit_room) VALUES ($1,'room-s01')`, [consentId]),
      );
      expect(msg).toMatch(/expected ACCEPTED_BOTH/);
    });
  });

  test('S02 Session rejected when video_deadline expired', async () => {
    await withRollback(ownerPool, async (c) => {
      const { userA, userB, intentId } = await seedAcceptedIntent(c);
      const r = await c.query<IdRow>(
        `INSERT INTO consents (match_intent_id,user_a_id,user_b_id,user_a_status,user_b_status,status,
                               accepted_both_at, video_deadline, expires_at)
         VALUES ($1,$2,$3,'ACCEPTED','ACCEPTED','ACCEPTED_BOTH',
                 now() - interval '3 hours', now() - interval '2 hours', now() + interval '1 hour')
         RETURNING id`,
        [intentId, userA, userB],
      );
      const msg = await expectRejection(() =>
        c.query(`INSERT INTO sessions (consent_id, livekit_room) VALUES ($1,'room-s02')`, [first(r).id]),
      );
      expect(msg).toMatch(/video window expired/);
    });
  });

  test('S03 Session rejected when user A is SUSPENDED', async () => {
    await withRollback(ownerPool, async (c) => {
      const { consentId, userA } = await mkConsent(c, 'ACCEPTED_BOTH');
      await c.query(`UPDATE users SET status='SUSPENDED' WHERE id=$1`, [userA]);
      const msg = await expectRejection(() =>
        c.query(`INSERT INTO sessions (consent_id, livekit_room) VALUES ($1,'room-s03')`, [consentId]),
      );
      expect(msg).toMatch(/participant not ACTIVE/);
    });
  });

  test('S04 Session rejected when user B is PENDING_DELETION', async () => {
    await withRollback(ownerPool, async (c) => {
      const { consentId, userB } = await mkConsent(c, 'ACCEPTED_BOTH');
      await c.query(`UPDATE users SET status='PENDING_DELETION' WHERE id=$1`, [userB]);
      const msg = await expectRejection(() =>
        c.query(`INSERT INTO sessions (consent_id, livekit_room) VALUES ($1,'room-s04')`, [consentId]),
      );
      expect(msg).toMatch(/participant not ACTIVE/);
    });
  });

  test('S05 Session rejected when Block A->B exists', async () => {
    await withRollback(ownerPool, async (c) => {
      const { consentId, userA, userB } = await mkConsent(c, 'ACCEPTED_BOTH');
      await c.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)`, [userA, userB]);
      const msg = await expectRejection(() =>
        c.query(`INSERT INTO sessions (consent_id, livekit_room) VALUES ($1,'room-s05')`, [consentId]),
      );
      expect(msg).toMatch(/block exists between participants/);
    });
  });

  test('S06 Session rejected when Block B->A exists (reverse direction)', async () => {
    await withRollback(ownerPool, async (c) => {
      const { consentId, userA, userB } = await mkConsent(c, 'ACCEPTED_BOTH');
      await c.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)`, [userB, userA]);
      const msg = await expectRejection(() =>
        c.query(`INSERT INTO sessions (consent_id, livekit_room) VALUES ($1,'room-s06')`, [consentId]),
      );
      expect(msg).toMatch(/block exists between participants/);
    });
  });

  test('S07 Session rejected for invalid consent_id', async () => {
    await withRollback(ownerPool, async (c) => {
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO sessions (consent_id, livekit_room)
           VALUES (gen_random_uuid(),'room-s07')`,
        ),
      );
      expect(msg).toMatch(/not found|violates foreign key/i);
    });
  });

  test('S08 second Session for the same Consent is rejected (UNIQUE consent_id)', async () => {
    await withRollback(ownerPool, async (c) => {
      const { consentId } = await mkConsent(c, 'ACCEPTED_BOTH');
      await c.query(`INSERT INTO sessions (consent_id, livekit_room) VALUES ($1,'room-s08-a')`, [consentId]);
      const msg = await expectRejection(() =>
        c.query(`INSERT INTO sessions (consent_id, livekit_room) VALUES ($1,'room-s08-b')`, [consentId]),
      );
      expect(msg).toMatch(/duplicate key|sessions_consent_id_key/i);
    });
  });

  test('S09 happy path: eligible Consent DOES allow Session (control test)', async () => {
    await withRollback(ownerPool, async (c) => {
      const { consentId } = await mkConsent(c, 'ACCEPTED_BOTH');
      const r = await c.query<SessionRow>(
        `INSERT INTO sessions (consent_id, livekit_room) VALUES ($1,'room-s09') RETURNING id, status`,
        [consentId],
      );
      expect(first(r).status).toBe('CREATED');
    });
  });
});

describe('REPORTS / BLOCKS self-reference', () => {
  test('N15 self-report is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const u = await c.query<IdRow>(
        `INSERT INTO users (google_subject_id) VALUES ('n15') RETURNING id`,
      );
      const msg = await expectRejection(() =>
        c.query(
          `INSERT INTO reports (reporter_id, reported_id, category, severity)
           VALUES ($1,$1,'abuse','HIGH')`,
          [first(u).id],
        ),
      );
      expect(msg).toMatch(/chk_no_self_report/);
    });
  });

  test('N16 self-block is rejected', async () => {
    await withRollback(ownerPool, async (c) => {
      const u = await c.query<IdRow>(
        `INSERT INTO users (google_subject_id) VALUES ('n16') RETURNING id`,
      );
      const msg = await expectRejection(() =>
        c.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$1)`, [first(u).id]),
      );
      expect(msg).toMatch(/chk_no_self_block/);
    });
  });
});
