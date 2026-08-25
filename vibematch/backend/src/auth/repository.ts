import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING_DELETION' | 'DELETED';

export interface AuthUser {
  id: string;
  googleSubjectId: string;
  phoneVerified: boolean;
  status: UserStatus;
  isNewUser: boolean;
}

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface PhoneVerification {
  id: string;
  userId: string;
  providerVerificationId: string;
  phoneHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
}

type UserRow = {
  id: string;
  google_subject_id: string;
  phone_verified: boolean;
  status: UserStatus;
  is_new_user: boolean;
};

type SessionRow = {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
};

type PhoneVerificationRow = {
  id: string;
  user_id: string;
  provider_verification_id: string;
  phone_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  attempts: number;
};

type IdRow = { id: string };

const first = <T extends QueryResultRow>(result: QueryResult<T>): T => {
  const row = result.rows[0];
  if (!row) throw new Error('Expected database row');
  return row;
};

export class AuthRepository {
  constructor(private readonly pool: Pool) {}

  async upsertGoogleUser(googleSubjectId: string): Promise<AuthUser> {
    const result = await this.pool.query<UserRow>(
      `WITH inserted AS (
         INSERT INTO users (google_subject_id)
         VALUES ($1)
         ON CONFLICT (google_subject_id) DO NOTHING
         RETURNING id, google_subject_id, phone_verified, status, TRUE AS is_new_user
       )
       SELECT id, google_subject_id, phone_verified, status, is_new_user
       FROM inserted
       UNION ALL
       SELECT id, google_subject_id, phone_verified, status, FALSE AS is_new_user
       FROM users
       WHERE google_subject_id = $1
       LIMIT 1`,
      [googleSubjectId],
    );
    const row = first(result);
    return {
      id: row.id,
      googleSubjectId: row.google_subject_id,
      phoneVerified: row.phone_verified,
      status: row.status,
      isNewUser: row.is_new_user,
    };
  }

  async createSession(userId: string, expiresAt: Date): Promise<AuthSession> {
    const result = await this.pool.query<SessionRow>(
      `INSERT INTO auth_sessions (user_id, expires_at)
       VALUES ($1, $2)
       RETURNING id, user_id, expires_at, revoked_at`,
      [userId, expiresAt],
    );
    return this.mapSession(first(result));
  }

  async revokeSession(userId: string, sessionId: string, revokedAt: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, $3)
       WHERE id = $1 AND user_id = $2`,
      [sessionId, userId, revokedAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findActiveSession(
    userId: string,
    sessionId: string,
    now: Date,
  ): Promise<AuthSession | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT id, user_id, expires_at, revoked_at
       FROM auth_sessions
       WHERE id = $1
         AND user_id = $2
         AND revoked_at IS NULL
         AND expires_at > $3`,
      [sessionId, userId, now],
    );
    const row = result.rows[0];
    return row ? this.mapSession(row) : null;
  }

  async touchSession(userId: string, sessionId: string, seenAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE auth_sessions
       SET last_seen_at = $3
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, userId, seenAt],
    );
  }

  async createPhoneVerification(params: {
    userId: string;
    providerVerificationId: string;
    phoneHash: string;
    expiresAt: Date;
  }): Promise<PhoneVerification> {
    const result = await this.pool.query<PhoneVerificationRow>(
      `INSERT INTO phone_verifications
         (user_id, provider_verification_id, phone_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, provider_verification_id, phone_hash,
                 expires_at, consumed_at, attempts`,
      [params.userId, params.providerVerificationId, params.phoneHash, params.expiresAt],
    );
    return this.mapPhoneVerification(first(result));
  }

  async findPendingPhoneVerification(
    userId: string,
    verificationId: string,
    now: Date,
  ): Promise<PhoneVerification | null> {
    const result = await this.pool.query<PhoneVerificationRow>(
      `SELECT id, user_id, provider_verification_id, phone_hash,
              expires_at, consumed_at, attempts
       FROM phone_verifications
       WHERE id = $1
         AND user_id = $2
         AND consumed_at IS NULL
         AND expires_at > $3`,
      [verificationId, userId, now],
    );
    const row = result.rows[0];
    return row ? this.mapPhoneVerification(row) : null;
  }

  async incrementPhoneVerificationAttempts(userId: string, verificationId: string): Promise<void> {
    await this.pool.query(
      `UPDATE phone_verifications
       SET attempts = attempts + 1
       WHERE id = $1 AND user_id = $2 AND consumed_at IS NULL`,
      [verificationId, userId],
    );
  }

  async consumePhoneVerificationAndMarkUserVerified(
    userId: string,
    verificationId: string,
    consumedAt: Date,
  ): Promise<boolean> {
    return this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const consumed = await client.query<IdRow>(
          `UPDATE phone_verifications
           SET consumed_at = $3, attempts = attempts + 1
           WHERE id = $1
             AND user_id = $2
             AND consumed_at IS NULL
             AND expires_at > $3
           RETURNING id`,
          [verificationId, userId, consumedAt],
        );
        if ((consumed.rowCount ?? 0) === 0) {
          await client.query('ROLLBACK');
          return false;
        }

        await client.query(`UPDATE users SET phone_verified = TRUE WHERE id = $1`, [userId]);
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private mapSession(row: SessionRow): AuthSession {
    return {
      id: row.id,
      userId: row.user_id,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  }

  private mapPhoneVerification(row: PhoneVerificationRow): PhoneVerification {
    return {
      id: row.id,
      userId: row.user_id,
      providerVerificationId: row.provider_verification_id,
      phoneHash: row.phone_hash,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      attempts: row.attempts,
    };
  }
}
