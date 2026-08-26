import { createHmac, timingSafeEqual } from 'node:crypto';
import { LiveKitTokenProvider } from '../../backend/src/video/livekit-token-provider';

const secret = 'test-livekit-secret-at-least-32-bytes';
const fixedNow = new Date('2026-08-26T20:00:00.000Z');

type DecodedToken = {
  protectedHeader: Record<string, unknown>;
  payload: Record<string, unknown>;
};

function decodeAndVerifyHs256(token: string): DecodedToken {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error('Invalid JWT produced by LiveKitTokenProvider');
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = createHmac('sha256', secret).update(signingInput).digest();
  const actualSignature = Buffer.from(encodedSignature, 'base64url');

  expect(actualSignature.length).toBe(expectedSignature.length);
  expect(timingSafeEqual(actualSignature, expectedSignature)).toBe(true);

  return {
    protectedHeader: JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >,
    payload: JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >,
  };
}

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

    const { payload, protectedHeader } = decodeAndVerifyHs256(token);

    expect(protectedHeader.alg).toBe('HS256');
    expect(payload.iss).toBe('test-api-key');
    expect(payload.sub).toBe('33333333-3333-4333-8333-333333333333');
    expect(Number(payload.exp) - Number(payload.iat)).toBe(120);
    expect(Number(payload.iat)).toBe(Math.floor(fixedNow.getTime() / 1000));
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
    expect(() => new LiveKitTokenProvider({ apiKey: '', apiSecret: secret })).toThrow(
      /API key is required/,
    );
    expect(() => new LiveKitTokenProvider({ apiKey: 'key', apiSecret: '' })).toThrow(
      /API secret is required/,
    );
  });
});
