import type { Pool, QueryResultRow } from 'pg';
import type {
  AuthorizedVideoParticipant,
  VideoRateLimitScope,
  VideoSession,
  VideoSessionRepositoryPort,
} from './service';

interface VideoSessionRow extends QueryResultRow {
  id: string;
  consent_id: string;
  livekit_room: string;
  status: 'CREATED' | 'ACTIVE' | 'ENDED';
  revocation_pending: boolean;
  revoked_at: Date | null;
}

interface AuthorizedParticipantRow extends QueryResultRow {
  session_id: string;
  room_name: string;
  user_id: string;
}

export class VideoSessionRepository implements VideoSessionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async consumeRateLimit(
    userId: string,
    scope: VideoRateLimitScope,
    now: Date,
    limit: number,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO video_rate_limits (user_id, scope, window_started_at, request_count)
       VALUES ($1, $2, date_trunc('minute', $3::timestamptz), 1)
       ON CONFLICT (user_id, scope, window_started_at)
       DO UPDATE SET request_count = video_rate_limits.request_count + 1
       WHERE video_rate_limits.request_count < $4
       RETURNING request_count`,
      [userId, scope, now, limit],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async createAuthorized(
    userId: string,
    consentId: string,
    roomName: string,
    now: Date,
  ): Promise<VideoSession | null> {
    const result = await this.pool.query<VideoSessionRow>(
      `INSERT INTO sessions (consent_id, livekit_room)
       SELECT c.id, $3
       FROM consents c
       JOIN users ua ON ua.id = c.user_a_id
       JOIN users ub ON ub.id = c.user_b_id
       WHERE c.id = $2
         AND ($1 = c.user_a_id OR $1 = c.user_b_id)
         AND c.status = 'ACCEPTED_BOTH'
         AND c.video_deadline IS NOT NULL
         AND c.video_deadline > $4
         AND ua.status = 'ACTIVE' AND ub.status = 'ACTIVE'
         AND ua.phone_verified = TRUE AND ub.phone_verified = TRUE
         AND ua.age_assurance_status = 'APPROVED'
         AND ub.age_assurance_status = 'APPROVED'
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_id = c.user_a_id AND b.blocked_id = c.user_b_id)
              OR (b.blocker_id = c.user_b_id AND b.blocked_id = c.user_a_id)
         )
       ON CONFLICT (consent_id) DO NOTHING
       RETURNING id, consent_id, livekit_room, status, revocation_pending, revoked_at`,
      [userId, consentId, roomName, now],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async revalidateParticipant(
    userId: string,
    sessionId: string,
    now: Date,
  ): Promise<AuthorizedVideoParticipant | null> {
    const result = await this.pool.query<AuthorizedParticipantRow>(
      `SELECT s.id AS session_id, s.livekit_room AS room_name, $1::uuid AS user_id
       FROM sessions s
       JOIN consents c ON c.id = s.consent_id
       JOIN users ua ON ua.id = c.user_a_id
       JOIN users ub ON ub.id = c.user_b_id
       WHERE s.id = $2
         AND ($1 = c.user_a_id OR $1 = c.user_b_id)
         AND s.status IN ('CREATED', 'ACTIVE')
         AND s.revocation_pending = FALSE
         AND s.revoked_at IS NULL
         AND c.status = 'ACCEPTED_BOTH'
         AND c.video_deadline IS NOT NULL
         AND c.video_deadline > $3
         AND ua.status = 'ACTIVE' AND ub.status = 'ACTIVE'
         AND ua.phone_verified = TRUE AND ub.phone_verified = TRUE
         AND ua.age_assurance_status = 'APPROVED'
         AND ub.age_assurance_status = 'APPROVED'
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_id = c.user_a_id AND b.blocked_id = c.user_b_id)
              OR (b.blocker_id = c.user_b_id AND b.blocked_id = c.user_a_id)
         )
       LIMIT 1`,
      [userId, sessionId, now],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { sessionId: row.session_id, roomName: row.room_name, userId: row.user_id };
  }

  private map(row: VideoSessionRow): VideoSession {
    return {
      id: row.id,
      consentId: row.consent_id,
      livekitRoom: row.livekit_room,
      status: row.status,
      revocationPending: row.revocation_pending,
      revokedAt: row.revoked_at,
    };
  }
}
