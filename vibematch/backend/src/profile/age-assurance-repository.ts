import type { Pool, QueryResultRow } from 'pg';
import type {
  AgeAssuranceRepositoryPort,
  AgeAssuranceSession,
  AgeAssuranceStatus,
} from './age-assurance';

interface AgeAssuranceRow extends QueryResultRow {
  age_assurance_status: AgeAssuranceStatus;
}

interface AgeSessionRow extends QueryResultRow {
  user_id: string;
  provider_session_ref: string;
  verification_url: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export class AgeAssuranceRepository implements AgeAssuranceRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getStatus(userId: string): Promise<AgeAssuranceStatus | null> {
    const result = await this.pool.query<AgeAssuranceRow>(
      `SELECT age_assurance_status
       FROM users
       WHERE id = $1 AND status = 'ACTIVE'`,
      [userId],
    );
    return result.rows[0]?.age_assurance_status ?? null;
  }

  async savePendingSession(
    userId: string,
    providerSessionRef: string,
    verificationUrl: string,
    now: Date,
  ): Promise<AgeAssuranceSession | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query<{ id: string }>(
        `UPDATE users
         SET age_assurance_status = 'PENDING', updated_at = $2
         WHERE id = $1 AND status = 'ACTIVE'
         RETURNING id`,
        [userId, now],
      );
      if (!user.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const result = await client.query<AgeSessionRow>(
        `INSERT INTO age_assurance_sessions
           (user_id, provider_session_ref, verification_url, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'PENDING', $4, $4)
         ON CONFLICT (user_id) DO UPDATE
         SET provider_session_ref = EXCLUDED.provider_session_ref,
             verification_url = EXCLUDED.verification_url,
             status = 'PENDING',
             updated_at = EXCLUDED.updated_at
         RETURNING user_id, provider_session_ref, verification_url, status`,
        [userId, providerSessionRef, verificationUrl, now],
      );
      await client.query('COMMIT');
      return this.mapSession(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getSession(userId: string): Promise<AgeAssuranceSession | null> {
    const result = await this.pool.query<AgeSessionRow>(
      `SELECT user_id, provider_session_ref, verification_url, status
       FROM age_assurance_sessions
       WHERE user_id = $1`,
      [userId],
    );
    return this.mapSession(result.rows[0]);
  }

  async applyDecision(
    userId: string,
    providerSessionRef: string,
    status: 'PENDING' | 'APPROVED' | 'REJECTED',
    now: Date,
  ): Promise<AgeAssuranceStatus | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query<{ user_id: string }>(
        `UPDATE age_assurance_sessions
         SET status = $3, updated_at = $4
         WHERE user_id = $1 AND provider_session_ref = $2
         RETURNING user_id`,
        [userId, providerSessionRef, status, now],
      );
      if (!session.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const user = await client.query<AgeAssuranceRow>(
        `UPDATE users
         SET age_assurance_status = $2, updated_at = $3
         WHERE id = $1 AND status = 'ACTIVE'
         RETURNING age_assurance_status`,
        [userId, status, now],
      );
      await client.query('COMMIT');
      return user.rows[0]?.age_assurance_status ?? null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private mapSession(row: AgeSessionRow | undefined): AgeAssuranceSession | null {
    if (!row) return null;
    return {
      userId: row.user_id,
      providerSessionRef: row.provider_session_ref,
      verificationUrl: row.verification_url,
      status: row.status,
    };
  }
}
