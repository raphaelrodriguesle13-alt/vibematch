import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type {
  Block,
  ModerationRepositoryPort,
  Report,
  ReportCategory,
  ReportSeverity,
} from './service';

interface BlockRow extends QueryResultRow {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: Date;
}

interface ReportRow extends QueryResultRow {
  id: string;
  reporter_id: string;
  reported_id: string;
  session_id: string | null;
  category: ReportCategory;
  severity: ReportSeverity;
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'ESCALATED';
  created_at: Date;
}

export class ModerationRepository implements ModerationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createBlock(blockerId: string, blockedId: string): Promise<Block | null> {
    const result = await this.pool.query<BlockRow>(
      `INSERT INTO blocks (blocker_id, blocked_id)
       SELECT $1, $2
       WHERE $1::uuid <> $2::uuid
         AND EXISTS (SELECT 1 FROM users WHERE id = $1)
         AND EXISTS (SELECT 1 FROM users WHERE id = $2)
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING
       RETURNING id, blocker_id, blocked_id, created_at`,
      [blockerId, blockedId],
    );
    const row = result.rows[0];
    return row ? this.mapBlock(row) : null;
  }

  async createReport(input: {
    reporterId: string;
    reportedId: string;
    sessionId: string | null;
    category: ReportCategory;
    severity: ReportSeverity;
    requiresHuman: boolean;
  }): Promise<Report | null> {
    return this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const report = await client.query<ReportRow>(
          `INSERT INTO reports (reporter_id, reported_id, session_id, category, severity)
           SELECT $1, $2, $3, $4, $5
           WHERE $1::uuid <> $2::uuid
             AND EXISTS (SELECT 1 FROM users WHERE id = $1)
             AND EXISTS (SELECT 1 FROM users WHERE id = $2)
             AND (
               $3::uuid IS NULL
               OR EXISTS (
                 SELECT 1
                 FROM sessions s
                 JOIN consents c ON c.id = s.consent_id
                 WHERE s.id = $3
                   AND ((c.user_a_id = $1 AND c.user_b_id = $2)
                     OR (c.user_a_id = $2 AND c.user_b_id = $1))
               )
             )
           RETURNING id, reporter_id, reported_id, session_id, category, severity, status, created_at`,
          [
            input.reporterId,
            input.reportedId,
            input.sessionId,
            input.category,
            input.severity,
          ],
        );
        const row = report.rows[0];
        if (!row) {
          await client.query('ROLLBACK');
          return null;
        }

        await client.query(
          `INSERT INTO moderation_cases (report_id, requires_human)
           VALUES ($1, $2)`,
          [row.id, input.requiresHuman],
        );
        await client.query('COMMIT');
        return this.mapReport(row);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  private mapBlock(row: BlockRow): Block {
    return {
      id: row.id,
      blockerId: row.blocker_id,
      blockedId: row.blocked_id,
      createdAt: row.created_at,
    };
  }

  private mapReport(row: ReportRow): Report {
    return {
      id: row.id,
      reporterId: row.reporter_id,
      reportedId: row.reported_id,
      sessionId: row.session_id,
      category: row.category,
      severity: row.severity,
      status: row.status,
      createdAt: row.created_at,
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
