import {
  VideoSessionService,
  type AuthorizedVideoParticipant,
  type VideoRateLimitScope,
  type VideoSession,
  type VideoSessionRepositoryPort,
  type VideoTokenProvider,
} from '../../backend/src/video/service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONSENT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-08-26T12:00:00.000Z');

class FakeVideoRepository implements VideoSessionRepositoryPort {
  createResult: VideoSession | null = {
    id: SESSION_ID,
    consentId: CONSENT_ID,
    livekitRoom: 'vibematch-test-room',
    status: 'CREATED',
    revocationPending: false,
    revokedAt: null,
  };
  revalidateResult: AuthorizedVideoParticipant | null = {
    sessionId: SESSION_ID,
    roomName: 'vibematch-test-room',
    userId: USER_ID,
  };
  rateLimitAllowed = true;
  rateLimitCalls: Array<{ userId: string; scope: VideoRateLimitScope; now: Date; limit: number }> =
    [];
  createCall: { userId: string; consentId: string; roomName: string; now: Date } | null = null;
  revalidateCall: { userId: string; sessionId: string; now: Date } | null = null;

  consumeRateLimit(
    userId: string,
    scope: VideoRateLimitScope,
    now: Date,
    limit: number,
  ): Promise<boolean> {
    this.rateLimitCalls.push({ userId, scope, now, limit });
    return Promise.resolve(this.rateLimitAllowed);
  }

  createAuthorized(
    userId: string,
    consentId: string,
    roomName: string,
    now: Date,
  ): Promise<VideoSession | null> {
    this.createCall = { userId, consentId, roomName, now };
    return Promise.resolve(this.createResult);
  }

  revalidateParticipant(
    userId: string,
    sessionId: string,
    now: Date,
  ): Promise<AuthorizedVideoParticipant | null> {
    this.revalidateCall = { userId, sessionId, now };
    return Promise.resolve(this.revalidateResult);
  }
}

class FakeTokenProvider implements VideoTokenProvider {
  calls: Array<{ sessionId: string; roomName: string; userId: string; ttlSeconds: number }> = [];
  fail = false;

  issueParticipantToken(input: {
    sessionId: string;
    roomName: string;
    userId: string;
    ttlSeconds: number;
  }): Promise<string> {
    this.calls.push(input);
    if (this.fail) return Promise.reject(new Error('provider failed'));
    return Promise.resolve('signed-livekit-token');
  }
}

describe('VideoSessionService', () => {
  test('rate limits session creation before creating a room', async () => {
    const repository = new FakeVideoRepository();
    repository.rateLimitAllowed = false;
    const provider = new FakeTokenProvider();
    const service = new VideoSessionService(repository, provider, () => NOW);

    await expect(service.create(USER_ID, CONSENT_ID)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(repository.rateLimitCalls).toEqual([
      { userId: USER_ID, scope: 'SESSION_CREATE', now: NOW, limit: 30 },
    ]);
    expect(repository.createCall).toBeNull();
  });

  test('creates only through the authorized repository path with a server room name', async () => {
    const repository = new FakeVideoRepository();
    const provider = new FakeTokenProvider();
    const service = new VideoSessionService(repository, provider, () => NOW);

    await service.create(USER_ID, CONSENT_ID);

    expect(repository.createCall).not.toBeNull();
    expect(repository.createCall).toMatchObject({
      userId: USER_ID,
      consentId: CONSENT_ID,
      now: NOW,
    });
    expect(repository.createCall?.roomName).toMatch(/^vibematch-[0-9a-f-]+$/i);
  });

  test('rate limits token requests before revalidation and signing', async () => {
    const repository = new FakeVideoRepository();
    repository.rateLimitAllowed = false;
    const provider = new FakeTokenProvider();
    const service = new VideoSessionService(repository, provider, () => NOW);

    await expect(service.issueToken(USER_ID, SESSION_ID)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(repository.rateLimitCalls).toEqual([
      { userId: USER_ID, scope: 'TOKEN', now: NOW, limit: 30 },
    ]);
    expect(repository.revalidateCall).toBeNull();
    expect(provider.calls).toHaveLength(0);
  });

  test('never signs a token when immediate server-side revalidation fails', async () => {
    const repository = new FakeVideoRepository();
    repository.revalidateResult = null;
    const provider = new FakeTokenProvider();
    const service = new VideoSessionService(repository, provider, () => NOW);

    await expect(service.issueToken(USER_ID, SESSION_ID)).rejects.toMatchObject({
      code: 'VIDEO_NOT_AUTHORIZED',
    });
    expect(provider.calls).toHaveLength(0);
  });

  test('revalidates immediately before token signing and uses authenticated identity', async () => {
    const repository = new FakeVideoRepository();
    const provider = new FakeTokenProvider();
    const service = new VideoSessionService(repository, provider, () => NOW, 90);

    await expect(service.issueToken(USER_ID, SESSION_ID)).resolves.toBe('signed-livekit-token');

    expect(repository.revalidateCall).toEqual({ userId: USER_ID, sessionId: SESSION_ID, now: NOW });
    expect(provider.calls).toEqual([
      {
        sessionId: SESSION_ID,
        roomName: 'vibematch-test-room',
        userId: USER_ID,
        ttlSeconds: 90,
      },
    ]);
  });

  test('maps signer failures without leaking provider details', async () => {
    const repository = new FakeVideoRepository();
    const provider = new FakeTokenProvider();
    provider.fail = true;
    const service = new VideoSessionService(repository, provider, () => NOW);

    await expect(service.issueToken(USER_ID, SESSION_ID)).rejects.toMatchObject({
      code: 'VIDEO_PROVIDER_UNAVAILABLE',
    });
  });
});
