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

export class AuthIdentityRepository {
  constructor(private readonly pool: Pool) {}

  async findOrCreateUser(provider: AuthIdentityProvider, externalSubject: string): Promise<IdentityUser> {
    const subject = externalSubject.trim();
    if (!subject) throw new Error('External identity subject is required');
    const existing = await this.find(provider, subject);
    if (existing) return { ...existing, isNewUser: false };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await this.findWithClient(client, provider, subject);
      if (current) {
        await client.query('COMMIT');
        return { ...current, isNewUser: false };
      }
      const created = await client.query<IdentityRow>(
        `INSERT INTO users (google_subject_id, phone_verified)
         VALUES ($1, $2)
         RETURNING id, phone_verified, status`,
        [provider === 'GOOGLE' ? subject : null, provider === 'PHONE'],
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
        await client.query('COMMIT');
        return { id: user.id, phoneVerified: user.phone_verified, status: user.status, isNewUser: true };
      }
      await client.query('ROLLBACK');
      const winner = await this.find(provider, subject);
      if (!winner) throw new Error('Identity conflict winner was not visible');
      return { ...winner, isNewUser: false };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async find(provider: AuthIdentityProvider, subject: string): Promise<Omit<IdentityUser, 'isNewUser'> | null> {
    const result = await this.pool.query<IdentityRow>(
      `SELECT u.id, u.phone_verified, u.status
       FROM auth_identities i JOIN users u ON u.id = i.user_id
       WHERE i.provider = $1 AND i.external_subject = $2`,
      [provider, subject],
    );
    const row = result.rows[0];
    return row ? { id: row.id, phoneVerified: row.phone_verified, status: row.status } : null;
  }

  private async findWithClient(client: PoolClient, provider: AuthIdentityProvider, subject: string): Promise<Omit<IdentityUser, 'isNewUser'> | null> {
    const result = await client.query<IdentityRow>(
      `SELECT u.id, u.phone_verified, u.status
       FROM auth_identities i JOIN users u ON u.id = i.user_id
       WHERE i.provider = $1 AND i.external_subject = $2
       FOR SHARE OF u`,
      [provider, subject],
    );
    const row = result.rows[0];
    return row ? { id: row.id, phoneVerified: row.phone_verified, status: row.status } : null;
  }
}
