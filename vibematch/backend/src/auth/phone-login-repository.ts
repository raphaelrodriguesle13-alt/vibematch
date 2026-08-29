import type { Pool, QueryResultRow } from 'pg';

export type PhoneLoginChallenge = {
  id: string;
  providerVerificationId: string;
  phoneHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
};

type ChallengeRow = QueryResultRow & {
  id: string;
  provider_verification_id: string;
  phone_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  attempts: number;
};

type PhoneHashRow = QueryResultRow & { phone_hash: string };

export class PhoneLoginRepository {
  constructor(private readonly pool: Pool) {}

  async createChallenge(params: {
    providerVerificationId: string;
    phoneHash: string;
    expiresAt: Date;
  }): Promise<PhoneLoginChallenge> {
    const result = await this.pool.query<ChallengeRow>(
      `INSERT INTO phone_login_challenges
         (provider_verification_id, phone_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id, provider_verification_id, phone_hash, expires_at, consumed_at, attempts`,
      [params.providerVerificationId, params.phoneHash, params.expiresAt],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Phone login challenge was not created');
    return this.mapChallenge(row);
  }

  async findPendingChallenge(id: string, now: Date): Promise<PhoneLoginChallenge | null> {
    const result = await this.pool.query<ChallengeRow>(
      `SELECT id, provider_verification_id, phone_hash, expires_at, consumed_at, attempts
       FROM phone_login_challenges
       WHERE id = $1
         AND consumed_at IS NULL
         AND expires_at > $2`,
      [id, now],
    );
    const row = result.rows[0];
    return row ? this.mapChallenge(row) : null;
  }

  async incrementAttempts(id: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE phone_login_challenges
       SET attempts = attempts + 1
       WHERE id = $1
         AND consumed_at IS NULL
         AND expires_at > $2`,
      [id, now],
    );
  }

  async consumeChallenge(id: string, maxAttempts: number, consumedAt: Date): Promise<string | null> {
    const result = await this.pool.query<PhoneHashRow>(
      `UPDATE phone_login_challenges
       SET consumed_at = $3,
           attempts = attempts + 1
       WHERE id = $1
         AND consumed_at IS NULL
         AND expires_at > $3
         AND attempts < $2
       RETURNING phone_hash`,
      [id, maxAttempts, consumedAt],
    );
    return result.rows[0]?.phone_hash ?? null;
  }

  private mapChallenge(row: ChallengeRow): PhoneLoginChallenge {
    return {
      id: row.id,
      providerVerificationId: row.provider_verification_id,
      phoneHash: row.phone_hash,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      attempts: row.attempts,
    };
  }
}
