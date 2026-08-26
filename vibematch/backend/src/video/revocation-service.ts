import type { Pool, QueryResultRow } from 'pg';

export type PendingVideoRevocation = {
  sessionId: string;
  roomName: string;
  endReason:
    | 'BLOCK'
    | 'ACCOUNT_DELETION'
    | 'USER_SUSPENDED'
    | 'MODERATION'
    | 'CONSENT_INVALIDATED'
    | 'TIMEOUT'
    | 'SYSTEM_ERROR';
};

interface PendingVideoRevocationRow extends QueryResultRow {
  session_id: string;
  room_name: string;
  end_reason: PendingVideoRevocation['endReason'] | null;
}

export interface VideoRoomTerminator {
  terminateRoom(roomName: string): Promise<void>;
}

export class VideoRevocationRepository {
  constructor(private readonly pool: Pool) {}

  async listPending(limit = 25): Promise<PendingVideoRevocation[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Revocation batch limit must be between 1 and 100');
    }

    const result = await this.pool.query<PendingVideoRevocationRow>(
      `SELECT id AS session_id, livekit_room AS room_name, end_reason
       FROM sessions
       WHERE revocation_pending = TRUE
         AND revoked_at IS NULL
         AND status <> 'ENDED'
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit],
    );

    return result.rows.map((row) => ({
      sessionId: row.session_id,
      roomName: row.room_name,
      endReason: row.end_reason ?? 'CONSENT_INVALIDATED',
    }));
  }

  async markRevoked(sessionId: string, endReason: PendingVideoRevocation['endReason'], now: Date) {
    await this.pool.query(
      `UPDATE sessions
       SET status = 'ENDED',
           end_reason = COALESCE(end_reason, $2),
           revocation_pending = FALSE,
           revoked_at = COALESCE(revoked_at, $3),
           ended_at = COALESCE(ended_at, $3)
       WHERE id = $1
         AND revocation_pending = TRUE
         AND revoked_at IS NULL`,
      [sessionId, endReason, now],
    );
  }
}

export class VideoRevocationService {
  constructor(
    private readonly repository: VideoRevocationRepository,
    private readonly roomTerminator: VideoRoomTerminator,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(limit = 25): Promise<{ revoked: number; failed: number }> {
    const pending = await this.repository.listPending(limit);
    let revoked = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        await this.roomTerminator.terminateRoom(item.roomName);
        await this.repository.markRevoked(item.sessionId, item.endReason, this.now());
        revoked += 1;
      } catch {
        // Fail closed: keep revocation_pending=true so a later retry can finish
        // provider cleanup. Token issuance already rejects revocation_pending rows.
        failed += 1;
      }
    }

    return { revoked, failed };
  }
}
