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
}
