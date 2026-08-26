import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { Consent, ConsentDecision, ConsentRepositoryPort, ConsentStatus } from './service';

interface ConsentRow extends QueryResultRow {
  id: string;
  match_intent_id: string;
  user_a_id: string;
  user_b_id: string;
  user_a_status: 'PENDING' | ConsentDecision;
  user_b_status: 'PENDING' | ConsentDecision;
  status: ConsentStatus;
  expires_at: Date;
  video_deadline: Date | null;
  accepted_both_at: Date | null;
}

export class ConsentRepository implements ConsentRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createEligible(
    userId: string,
    matchIntentId: string,
    expiresAt: Date,
  ): Promise<Consent | null> {
    const result = await this.pool.query<ConsentRow>(
      `INSERT INTO consents (match_intent_id, user_a_id, user_b_id, expires_at)
       SELECT mi.id, mi.sender_id, mi.receiver_id, $3
       FROM match_intents mi
       JOIN users ua ON ua.id = mi.sender_id
       JOIN users ub ON ub.id = mi.receiver_id
       WHERE mi.id = $2
         AND (mi.sender_id = $1 OR mi.receiver_id = $1)
         AND mi.status = 'ACCEPTED'
         AND mi.expires_at > now()
         AND ua.status = 'ACTIVE' AND ub.status = 'ACTIVE'
         AND ua.phone_verified = TRUE AND ub.phone_verified = TRUE
         AND ua.age_assurance_status = 'APPROVED'
         AND ub.age_assurance_status = 'APPROVED'
         AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = ua.id)
         AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = ub.id)
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_id = ua.id AND b.blocked_id = ub.id)
              OR (b.blocker_id = ub.id AND b.blocked_id = ua.id)
         )
       ON CONFLICT (match_intent_id) DO NOTHING
       RETURNING id, match_intent_id, user_a_id, user_b_id, user_a_status,
                 user_b_status, status, expires_at, video_deadline, accepted_both_at`,
      [userId, matchIntentId, expiresAt],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async decide(
    actingUserId: string,
    consentId: string,
    decision: ConsentDecision,
    authSessionRef: string,
    requestId: string,
    now: Date,
    videoDeadline: Date,
  ): Promise<Consent | null> {
    return this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const locked = await client.query<ConsentRow>(
          `SELECT id, match_intent_id, user_a_id, user_b_id, user_a_status,
                  user_b_status, status, expires_at, video_deadline, accepted_both_at
           FROM consents
           WHERE id = $1
           FOR UPDATE`,
          [consentId],
        );
        const current = locked.rows[0];
        if (!current || current.status !== 'PENDING') {
          await client.query('ROLLBACK');
          return null;
        }
        if (current.expires_at <= now) {
          await client.query(
            `UPDATE consents SET status = 'EXPIRED', updated_at = $2 WHERE id = $1`,
            [consentId, now],
          );
          await client.query('COMMIT');
          return null;
        }

        const actingSide =
          actingUserId === current.user_a_id
            ? 'A'
            : actingUserId === current.user_b_id
              ? 'B'
              : null;
        if (!actingSide) {
          await client.query('ROLLBACK');
          return null;
        }
        const actorStatus = actingSide === 'A' ? current.user_a_status : current.user_b_status;
        if (actorStatus !== 'PENDING') {
          await client.query('ROLLBACK');
          return null;
        }

        const eligible = await client.query(
          `SELECT 1
           WHERE EXISTS (
             SELECT 1 FROM users u
             WHERE u.id = $1
               AND u.status = 'ACTIVE'
               AND u.phone_verified = TRUE
               AND u.age_assurance_status = 'APPROVED'
           )
             AND EXISTS (
             SELECT 1 FROM users u
             WHERE u.id = $2
               AND u.status = 'ACTIVE'
               AND u.phone_verified = TRUE
               AND u.age_assurance_status = 'APPROVED'
           )
             AND NOT EXISTS (
             SELECT 1 FROM blocks b
             WHERE (b.blocker_id = $1 AND b.blocked_id = $2)
                OR (b.blocker_id = $2 AND b.blocked_id = $1)
           )`,
          [current.user_a_id, current.user_b_id],
        );
        if (eligible.rowCount !== 1) {
          await client.query(
            `UPDATE consents
             SET status = 'CANCELLED', cancellation_reason = 'SYSTEM', updated_at = $2
             WHERE id = $1`,
            [consentId, now],
          );
          await client.query('COMMIT');
          return null;
        }

        await client.query(
          `INSERT INTO consent_decisions (
             consent_id, acting_user_id, decision, decided_at, auth_session_ref, request_id
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [consentId, actingUserId, decision, now, authSessionRef, requestId],
        );

        const updated =
          actingSide === 'A'
            ? await this.updateUserA(client, current, decision, now, videoDeadline)
            : await this.updateUserB(client, current, decision, now, videoDeadline);
        await client.query('COMMIT');
        return updated;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  private async updateUserA(
    client: PoolClient,
    current: ConsentRow,
    decision: ConsentDecision,
    now: Date,
    videoDeadline: Date,
  ): Promise<Consent> {
    const bothAccepted = decision === 'ACCEPTED' && current.user_b_status === 'ACCEPTED';
    const result = await client.query<ConsentRow>(
      `UPDATE consents
       SET user_a_status = $2,
           status = $3,
           accepted_both_at = $4,
           video_deadline = $5,
           updated_at = $6
       WHERE id = $1
       RETURNING id, match_intent_id, user_a_id, user_b_id, user_a_status,
                 user_b_status, status, expires_at, video_deadline, accepted_both_at`,
      [
        current.id,
        decision,
        decision === 'DECLINED' ? 'DECLINED' : bothAccepted ? 'ACCEPTED_BOTH' : 'PENDING',
        bothAccepted ? now : null,
        bothAccepted ? videoDeadline : null,
        now,
      ],
    );
    return this.mapRequired(result.rows[0]);
  }

  private async updateUserB(
    client: PoolClient,
    current: ConsentRow,
    decision: ConsentDecision,
    now: Date,
    videoDeadline: Date,
  ): Promise<Consent> {
    const bothAccepted = decision === 'ACCEPTED' && current.user_a_status === 'ACCEPTED';
    const result = await client.query<ConsentRow>(
      `UPDATE consents
       SET user_b_status = $2,
           status = $3,
           accepted_both_at = $4,
           video_deadline = $5,
           updated_at = $6
       WHERE id = $1
       RETURNING id, match_intent_id, user_a_id, user_b_id, user_a_status,
                 user_b_status, status, expires_at, video_deadline, accepted_both_at`,
      [
        current.id,
        decision,
        decision === 'DECLINED' ? 'DECLINED' : bothAccepted ? 'ACCEPTED_BOTH' : 'PENDING',
        bothAccepted ? now : null,
        bothAccepted ? videoDeadline : null,
        now,
      ],
    );
    return this.mapRequired(result.rows[0]);
  }

  private mapRequired(row: ConsentRow | undefined): Consent {
    if (!row) throw new Error('Expected consent row');
    return this.map(row);
  }

  private map(row: ConsentRow): Consent {
    return {
      id: row.id,
      matchIntentId: row.match_intent_id,
      userAId: row.user_a_id,
      userBId: row.user_b_id,
      userAStatus: row.user_a_status,
      userBStatus: row.user_b_status,
      status: row.status,
      expiresAt: row.expires_at,
      videoDeadline: row.video_deadline,
      acceptedBothAt: row.accepted_both_at,
    };
  }

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }
}
