import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type {
  MatchIntent,
  MatchIntentDecision,
  MatchIntentRepositoryPort,
  MatchIntentStatus,
} from './service';

interface MatchIntentRow extends QueryResultRow {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: MatchIntentStatus;
  expires_at: Date;
  responded_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
}

export class MatchIntentRepository implements MatchIntentRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createEligible(
    senderId: string,
    receiverId: string,
    expiresAt: Date,
  ): Promise<MatchIntent | null> {
    const result = await this.pool.query<MatchIntentRow>(
      `INSERT INTO match_intents (sender_id, receiver_id, status, expires_at)
       SELECT $1, $2, 'SENT', $3
       WHERE $1::uuid <> $2::uuid
         AND EXISTS (
           SELECT 1 FROM users u
           JOIN profiles p ON p.user_id = u.id
           WHERE u.id = $1
             AND u.status = 'ACTIVE'
             AND u.phone_verified = TRUE
             AND u.age_assurance_status = 'APPROVED'
         )
         AND EXISTS (
           SELECT 1 FROM users u
           JOIN profiles p ON p.user_id = u.id
           WHERE u.id = $2
             AND u.status = 'ACTIVE'
             AND u.phone_verified = TRUE
             AND u.age_assurance_status = 'APPROVED'
         )
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_id = $2)
              OR (b.blocker_id = $2 AND b.blocked_id = $1)
         )
         AND NOT EXISTS (
           SELECT 1 FROM match_intents mi
           WHERE mi.status = 'SENT'
             AND ((mi.sender_id = $1 AND mi.receiver_id = $2)
               OR (mi.sender_id = $2 AND mi.receiver_id = $1))
         )
       ON CONFLICT DO NOTHING
       RETURNING id, sender_id, receiver_id, status, expires_at,
                 responded_at, closed_at, created_at`,
      [senderId, receiverId, expiresAt],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async listIncoming(receiverId: string, now: Date): Promise<MatchIntent[]> {
    await this.pool.query(
      `UPDATE match_intents
       SET status = 'EXPIRED', closed_at = $2
       WHERE receiver_id = $1 AND status = 'SENT' AND expires_at <= $2`,
      [receiverId, now],
    );
    const result = await this.pool.query<MatchIntentRow>(
      `SELECT mi.id, mi.sender_id, mi.receiver_id, mi.status, mi.expires_at,
              mi.responded_at, mi.closed_at, mi.created_at
       FROM match_intents mi
       JOIN users sender ON sender.id = mi.sender_id
       JOIN users receiver ON receiver.id = mi.receiver_id
       WHERE mi.receiver_id = $1
         AND mi.status = 'SENT'
         AND mi.expires_at > $2
         AND sender.status = 'ACTIVE'
         AND receiver.status = 'ACTIVE'
         AND sender.phone_verified = TRUE
         AND receiver.phone_verified = TRUE
         AND sender.age_assurance_status = 'APPROVED'
         AND receiver.age_assurance_status = 'APPROVED'
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_id = mi.sender_id AND b.blocked_id = mi.receiver_id)
              OR (b.blocker_id = mi.receiver_id AND b.blocked_id = mi.sender_id)
         )
       ORDER BY mi.created_at DESC`,
      [receiverId, now],
    );
    return result.rows.map((row) => this.map(row));
  }

  async respond(
    receiverId: string,
    intentId: string,
    decision: MatchIntentDecision,
    now: Date,
  ): Promise<MatchIntent | null> {
    return this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const locked = await client.query<MatchIntentRow>(
          `SELECT id, sender_id, receiver_id, status, expires_at,
                  responded_at, closed_at, created_at
           FROM match_intents
           WHERE id = $1 AND receiver_id = $2
           FOR UPDATE`,
          [intentId, receiverId],
        );
        const current = locked.rows[0];
        if (!current || current.status !== 'SENT') {
          await client.query('ROLLBACK');
          return null;
        }
        if (current.expires_at <= now) {
          await client.query(
            `UPDATE match_intents
             SET status = 'EXPIRED', closed_at = $2
             WHERE id = $1`,
            [intentId, now],
          );
          await client.query('COMMIT');
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
          [current.sender_id, current.receiver_id],
        );
        if (eligible.rowCount !== 1) {
          await client.query(
            `UPDATE match_intents
             SET status = 'CANCELLED', closed_at = $2
             WHERE id = $1`,
            [intentId, now],
          );
          await client.query('COMMIT');
          return null;
        }

        const updated = await client.query<MatchIntentRow>(
          `UPDATE match_intents
           SET status = $2, responded_at = $3
           WHERE id = $1
           RETURNING id, sender_id, receiver_id, status, expires_at,
                     responded_at, closed_at, created_at`,
          [intentId, decision, now],
        );
        await client.query('COMMIT');
        const row = updated.rows[0];
        return row ? this.map(row) : null;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  private map(row: MatchIntentRow): MatchIntent {
    return {
      id: row.id,
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      status: row.status,
      expiresAt: row.expires_at,
      respondedAt: row.responded_at,
      closedAt: row.closed_at,
      createdAt: row.created_at,
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
