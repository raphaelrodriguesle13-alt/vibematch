import { randomUUID } from 'node:crypto';

export type VideoSession = {
  id: string;
  consentId: string;
  livekitRoom: string;
  status: 'CREATED' | 'ACTIVE' | 'ENDED';
  revocationPending: boolean;
  revokedAt: Date | null;
};

export type AuthorizedVideoParticipant = {
  sessionId: string;
  roomName: string;
  userId: string;
};

export interface VideoSessionRepositoryPort {
  createAuthorized(
    userId: string,
    consentId: string,
    roomName: string,
    now: Date,
  ): Promise<VideoSession | null>;
  revalidateParticipant(
    userId: string,
    sessionId: string,
    now: Date,
  ): Promise<AuthorizedVideoParticipant | null>;
}

export interface VideoTokenProvider {
  issueParticipantToken(input: {
    sessionId: string;
    roomName: string;
    userId: string;
    ttlSeconds: number;
  }): Promise<string>;
}

export type VideoAuthorizationErrorCode =
  'INVALID_VIDEO_REQUEST' | 'VIDEO_NOT_AUTHORIZED' | 'VIDEO_PROVIDER_UNAVAILABLE';

export class VideoAuthorizationError extends Error {
  constructor(
    readonly code: VideoAuthorizationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VideoAuthorizationError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class VideoSessionService {
  constructor(
    private readonly repository: VideoSessionRepositoryPort,
    private readonly tokenProvider: VideoTokenProvider,
    private readonly now: () => Date = () => new Date(),
    private readonly tokenTtlSeconds = 120,
  ) {}

  async create(userId: string, consentId: string): Promise<VideoSession> {
    if (!UUID.test(consentId)) {
      throw new VideoAuthorizationError('INVALID_VIDEO_REQUEST', 'Consent id is invalid');
    }
    const roomName = `vibematch-${randomUUID()}`;
    const session = await this.repository.createAuthorized(userId, consentId, roomName, this.now());
    if (!session) {
      throw new VideoAuthorizationError('VIDEO_NOT_AUTHORIZED', 'Video session is not authorized');
    }
    return session;
  }

  async issueToken(userId: string, sessionId: string): Promise<string> {
    if (!UUID.test(sessionId)) {
      throw new VideoAuthorizationError('INVALID_VIDEO_REQUEST', 'Session id is invalid');
    }

    // Security boundary: this database revalidation happens immediately before token signing.
    // The Android client cannot supply consent, age, block, or session authorization state.
    const authorized = await this.repository.revalidateParticipant(userId, sessionId, this.now());
    if (!authorized) {
      throw new VideoAuthorizationError('VIDEO_NOT_AUTHORIZED', 'Video token is not authorized');
    }

    try {
      return await this.tokenProvider.issueParticipantToken({
        sessionId: authorized.sessionId,
        roomName: authorized.roomName,
        userId: authorized.userId,
        ttlSeconds: this.tokenTtlSeconds,
      });
    } catch {
      throw new VideoAuthorizationError(
        'VIDEO_PROVIDER_UNAVAILABLE',
        'Video token provider is unavailable',
      );
    }
  }
}
