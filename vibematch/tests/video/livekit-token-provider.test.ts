import { jwtVerify } from 'jose';
import { LiveKitTokenProvider } from '../../backend/src/video/livekit-token-provider';

const secret = 'test-livekit-secret-at-least-32-bytes';
const key = new TextEncoder().encode(secret);
const fixedNow = new Date('2026-08-26T20:00:00.000Z');

describe('LiveKitTokenProvider', () => {
  test('mints a short-lived room-scoped participant token', async () => {
    const provider = new LiveKitTokenProvider({
      apiKey: 'test-api-key',
      apiSecret: secret,
      now: () => fixedNow,
    });

    const token = await provider.issueParticipantToken({
      sessionId: '22222222-2222-4222-8222-222222222222',
      roomName: 'vibematch-11111111-1111-4111-8111-111111111111',
      userId: '33333333-3333-4333-8333-333333333333',
      ttlSeconds: 120,
    });

    const { payload, protectedHeader } = await jwtVerify(token, key, {
      issuer: 'test-api-key',
      clockTolerance: 5,
      currentDate: fixedNow,
    });

    expect(protectedHeader.alg).toBe('HS256');
    expect(payload.sub).toBe('33333333-3333-4333-8333-333333333333');
    expect(payload.exp! - payload.iat!).toBe(120);
    expect(payload.video).toEqual({
      room: 'vibematch-11111111-1111-4111-8111-111111111111',
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    expect(JSON.parse(String(payload.metadata))).toEqual({
      session_id: '22222222-2222-4222-8222-222222222222',
    });
  });

  test('refuses long-lived participant credentials', async () => {
    const provider = new LiveKitTokenProvider({
      apiKey: 'test-api-key',
      apiSecret: secret,
    });

    await expect(
      provider.issueParticipantToken({
        sessionId: 'session',
        roomName: 'room',
        userId: 'user',
        ttlSeconds: 301,
      }),
    ).rejects.toThrow(/TTL must be between 1 and 300 seconds/);
  });

  test('fails closed when signing configuration is absent', () => {
    expect(
      () => new LiveKitTokenProvider({ apiKey: '', apiSecret: secret }),
    ).toThrow(/API key is required/);
    expect(
      () => new LiveKitTokenProvider({ apiKey: 'key', apiSecret: '' }),
    ).toThrow(/API secret is required/);
  });
});
