import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { UserStatus } from './repository';

export type AuthIdentityProvider = 'GOOGLE' | 'FACEBOOK' | 'PHONE';

export type IdentityUser = {
  id: string;
  phoneVerified: boolean;
  status: UserStatus;
  isNewUser: boolean;
};

type IdentityRow = QueryResultRow & {
  id: string;
  phone_verified: boolean;
  status: UserStatus;
};

type UserIdRow = QueryResultRow & { id: string };

type IdentityUserState = Omit<IdentityUser, 'isNewUser'>;

export class AuthIdentityRepository {
  constructor(private readonly pool: Pool) {}

  async findOrCreateUser(
    provider: AuthIdentityProvider,
    externalSubject: string,
  ): Promise<IdentityUser> {
    const subject = externalSubject.trim();
    if (!subject) throw new Error('External identity subject is required');

    const existing = await this.find(provider, subject);
    if (existing) {
      const verified = await this.ensureVerifiedPhone(provider, existing);
      return { ...verified, isNewUser: false };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await this.findWithClient(client, provider, subject);
      if (current) {
        const verified = await this.ensureVerifiedPhone(provider, current, client);
        await client.query('COMMIT');
        return { ...verified, isNewUser: false };
      }

      // svc_auth intentionally has INSERT only on google_subject_id. Other
      // user columns keep their database defaults; a verified PHONE identity
      // is promoted with the existing column-scoped UPDATE privilege below.
      const created = await client.query<IdentityRow>(
        `INSERT INTO users (google_subject_id)
         VALUES ($1)
         RETURNING id, phone_verified, status`,
        [provider === 'GOOGLE' ? subject : null],
      );
      const user = created.rows[0];
      if (!user) throw new Error('Identity user was not created');

      const identity = await client.query<UserIdRow>(
        `INSERT INTO auth_identities (user_id, provider, external_subject)
         VALUES ($1, $2, $3)
         ON CONFLICT (provider, external_subject) DO NOTHING
         RETURNING user_id AS id`,
        [user.id, provider, subject],
      );
      if (identity.rows[0]) {
        const verified = await this.ensureVerifiedPhone(provider, this.mapUser(user), client);
        await client.query('COMMIT');
        return { ...verified, isNewUser: true };
      }

      // Another transaction won the provider/subject race. Roll back the
      // orphan user, then re-read the winner under a fresh snapshot.
      await client.query('ROLLBACK');
      const winner = await this.find(provider, subject);
      if (!winner) throw new Error('Identity conflict winner was not visible');
      const verified = await this.ensureVerifiedPhone(provider, winner);
      return { ...verified, isNewUser: false };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async find(
    provider: AuthIdentityProvider,
    subject: string,
  ): Promise<IdentityUserState | null> {
    const result = await this.pool.query<IdentityRow>(
      `SELECT u.id, u.phone_verified, u.status
       FROM auth_identities i
       JOIN users u ON u.id = i.user_id
       WHERE i.provider = $1 AND i.external_subject = $2`,
      [provider, subject],
    );
    const row = result.rows[0];
    return row ? this.mapUser(row) : null;
  }

  private async findWithClient(
    client: PoolClient,
    provider: AuthIdentityProvider,
    subject: string,
  ): Promise<IdentityUserState | null> {
    const result = await client.query<IdentityRow>(
      `SELECT u.id, u.phone_verified, u.status
       FROM auth_identities i
       JOIN users u ON u.id = i.user_id
       WHERE i.provider = $1 AND i.external_subject = $2
       FOR SHARE OF u`,
      [provider, subject],
    );
    const row = result.rows[0];
    return row ? this.mapUser(row) : null;
  }

  private async ensureVerifiedPhone(
    provider: AuthIdentityProvider,
    user: IdentityUserState,
    client?: PoolClient,
  ): Promise<IdentityUserState> {
    if (provider !== 'PHONE' || user.phoneVerified || user.status !== 'ACTIVE') return user;

    const executor = client ?? this.pool;
    const result = await executor.query<IdentityRow>(
      `UPDATE users
       SET phone_verified = TRUE,
           updated_at = now()
       WHERE id = $1
         AND status = 'ACTIVE'
       RETURNING id, phone_verified, status`,
      [user.id],
    );
    const row = result.rows[0];
    if (!row) return user;
    return this.mapUser(row);
  }

  private mapUser(row: IdentityRow): IdentityUserState {
    return {
      id: row.id,
      phoneVerified: row.phone_verified,
      status: row.status,
    };
  }
}
