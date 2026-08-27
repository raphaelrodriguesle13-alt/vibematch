import type { Pool } from 'pg';
import type { AgeAssuranceProvider } from '../shared/providers';

export type AgeWebhookReconcileResult =
  | { outcome: 'APPLIED' | 'DUPLICATE_OR_STALE'; status: 'PENDING' | 'APPROVED' | 'REJECTED' }
  | { outcome: 'SESSION_NOT_FOUND' };

export class AgeWebhookReconciler {
  constructor(
    private readonly pool: Pool,
    private readonly provider: AgeAssuranceProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcileProviderSession(providerSessionRef: string): Promise<AgeWebhookReconcileResult> {
    const existing = await this.pool.query<{
      user_id: string;
      status: 'PENDING' | 'APPROVED' | 'REJECTED';
    }>(
      `SELECT user_id, status
       FROM age_assurance_sessions
       WHERE provider_session_ref = $1`,
      [providerSessionRef],
    );
    const session = existing.rows[0];
    if (!session) return { outcome: 'SESSION_NOT_FOUND' };

    const result = await this.provider.getResult(providerSessionRef);
    const decision = result.decision;
    const now = this.now();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query<{ status: 'PENDING' | 'APPROVED' | 'REJECTED' }>(
        `UPDATE age_assurance_sessions
         SET status = $2, updated_at = $3
         WHERE provider_session_ref = $1
           AND (
             status = 'PENDING'
             OR status = $2
             OR (status = 'APPROVED' AND $2 = 'REJECTED')
           )
         RETURNING status`,
        [providerSessionRef, decision, now],
      );

      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return { outcome: 'DUPLICATE_OR_STALE', status: session.status };
      }

      await client.query(
        `UPDATE users
         SET age_assurance_status = $2, updated_at = $3
         WHERE id = $1 AND status = 'ACTIVE'`,
        [session.user_id, decision, now],
      );
      await client.query('COMMIT');
      return {
        outcome: session.status === decision ? 'DUPLICATE_OR_STALE' : 'APPLIED',
        status: decision,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
