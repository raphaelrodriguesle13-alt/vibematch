import type { Pool, QueryResultRow } from 'pg';
import type { AgeAssuranceRepositoryPort, AgeAssuranceStatus } from './age-assurance';

interface AgeAssuranceRow extends QueryResultRow {
  age_assurance_status: AgeAssuranceStatus;
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
}
