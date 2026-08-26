import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import type {
  ProfileInterest,
  ProfileRepositoryPort,
  UpdateProfileInput,
  UserProfile,
} from './service';

interface ProfileRow extends QueryResultRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  language: string;
  region: string;
}

interface InterestRow extends QueryResultRow {
  id: string;
  label: string;
}

const first = <T extends QueryResultRow>(result: QueryResult<T>): T => {
  const row = result.rows[0];
  if (!row) throw new Error('Expected database row');
  return row;
};

export class ProfileRepository implements ProfileRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getProfile(userId: string): Promise<UserProfile | null> {
    const profile = await this.pool.query<ProfileRow>(
      `SELECT user_id, display_name, avatar_url, language, region
       FROM profiles
       WHERE user_id = $1`,
      [userId],
    );
    const row = profile.rows[0];
    if (!row) return null;

    const interests = await this.pool.query<InterestRow>(
      `SELECT i.id, i.label
       FROM user_interests ui
       JOIN interests i ON i.id = ui.interest_id
       WHERE ui.user_id = $1 AND i.active = TRUE
       ORDER BY i.label`,
      [userId],
    );

    return this.mapProfile(row, interests.rows);
  }

  async listActiveInterests(): Promise<ProfileInterest[]> {
    const result = await this.pool.query<InterestRow>(
      `SELECT id, label
       FROM interests
       WHERE active = TRUE
       ORDER BY label`,
    );
    return result.rows.map((row) => ({ id: row.id, label: row.label }));
  }

  async upsertProfile(userId: string, input: UpdateProfileInput): Promise<UserProfile> {
    return this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const interestIds = input.interestIds ?? [];
        if (interestIds.length > 0) {
          const valid = await client.query<{ id: string }>(
            `SELECT id FROM interests WHERE active = TRUE AND id = ANY($1::uuid[])`,
            [interestIds],
          );
          if (valid.rows.length !== interestIds.length) {
            throw new Error('INVALID_INTERESTS');
          }
        }

        const profile = await client.query<ProfileRow>(
          `INSERT INTO profiles (user_id, display_name, avatar_url, language, region)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id) DO UPDATE SET
             display_name = EXCLUDED.display_name,
             avatar_url = EXCLUDED.avatar_url,
             language = EXCLUDED.language,
             region = EXCLUDED.region,
             updated_at = now()
           RETURNING user_id, display_name, avatar_url, language, region`,
          [userId, input.displayName, input.avatarUrl ?? null, input.language, input.region],
        );

        await client.query('DELETE FROM user_interests WHERE user_id = $1', [userId]);
        if (interestIds.length > 0) {
          await client.query(
            `INSERT INTO user_interests (user_id, interest_id)
             SELECT $1, value::uuid
             FROM unnest($2::text[]) AS value`,
            [userId, interestIds],
          );
        }

        await client.query('COMMIT');
        const interests =
          interestIds.length === 0
            ? []
            : await this.listInterestsWithClient(client, interestIds);
        return this.mapProfile(first(profile), interests);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  private async listInterestsWithClient(
    client: PoolClient,
    interestIds: string[],
  ): Promise<InterestRow[]> {
    const result = await client.query<InterestRow>(
      `SELECT id, label
       FROM interests
       WHERE id = ANY($1::uuid[])
       ORDER BY label`,
      [interestIds],
    );
    return result.rows;
  }

  private mapProfile(row: ProfileRow, interests: InterestRow[]): UserProfile {
    return {
      userId: row.user_id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      language: row.language,
      region: row.region,
      interests: interests.map((interest) => ({ id: interest.id, label: interest.label })),
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
