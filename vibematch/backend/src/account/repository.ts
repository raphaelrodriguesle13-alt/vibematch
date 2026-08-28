import type { Pool } from 'pg';

export type AccountDeletionStatus = 'PENDING_DELETION' | 'DELETED';

type DeletionRow = { status: AccountDeletionStatus | null };

export class AccountDeletionRepository {
  constructor(private readonly pool: Pool) {}

  async requestDeletion(userId: string): Promise<AccountDeletionStatus | null> {
    const result = await this.pool.query<DeletionRow>(
      `SELECT public.request_account_deletion($1::uuid) AS status`,
      [userId],
    );
    return result.rows[0]?.status ?? null;
  }
}
