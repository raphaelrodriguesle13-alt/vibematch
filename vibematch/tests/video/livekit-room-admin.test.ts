import { decodeJwt, jwtVerify } from 'jose';
import { LiveKitRoomAdmin } from '../../backend/src/video/livekit-room-admin';

const secret = 'test-livekit-secret-value';
const key = new TextEncoder().encode(secret);

describe('LiveKitRoomAdmin', () => {
  it('uses a short room-scoped admin token and DeleteRoom endpoint', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const admin = new LiveKitRoomAdmin({
      baseUrl: 'https://example.livekit.cloud/',
      apiKey: 'test-key',
      apiSecret: secret,
      now: () => new Date('2026-08-26T20:00:00.000Z'),
      fetcher: async (url, init) => {
        calls.push({ url, init });
        return new Response('{}', { status: 200 });
      },
    });

    await admin.terminateRoom('vibematch-room-1');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://example.livekit.cloud/twirp/livekit.RoomService/DeleteRoom',
    );
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe(JSON.stringify({ room: 'vibematch-room-1' }));

    const headers = calls[0]?.init.headers as Record<string, string>;
    const token = headers.authorization.replace('Bearer ', '');
    const verified = await jwtVerify(token, key, { issuer: 'test-key' });
    expect(verified.payload.video).toEqual({ room: 'vibematch-room-1', roomAdmin: true });
    expect((verified.payload.exp ?? 0) - (verified.payload.iat ?? 0)).toBe(60);
  });

  it('rejects non-HTTPS admin endpoints', () => {
    expect(
      () =>
        new LiveKitRoomAdmin({
          baseUrl: 'http://example.test',
          apiKey: 'key',
          apiSecret: secret,
        }),
    ).toThrow('must use HTTPS');
  });

  it('fails closed when LiveKit rejects room termination', async () => {
    const admin = new LiveKitRoomAdmin({
      baseUrl: 'https://example.livekit.cloud',
      apiKey: 'key',
      apiSecret: secret,
      fetcher: async () => new Response('{}', { status: 503 }),
    });

    await expect(admin.terminateRoom('room')).rejects.toThrow('HTTP 503');
  });
});
