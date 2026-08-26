import { env } from '../../backend/src/config/env';

describe('video runtime configuration', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  test('keeps RTC and administrative LiveKit endpoints distinct', () => {
    process.env.LIVEKIT_URL = 'wss://project.livekit.cloud/';
    process.env.LIVEKIT_API_URL = 'https://project.livekit.cloud/';

    expect(env.liveKitRtcUrl()).toBe('wss://project.livekit.cloud');
    expect(env.liveKitApiUrl()).toBe('https://project.livekit.cloud');
  });

  test('fails closed when RTC endpoint is not secure WebSocket', () => {
    process.env.LIVEKIT_URL = 'https://project.livekit.cloud';
    expect(() => env.liveKitRtcUrl()).toThrow(/must use wss:\/\//);
  });

  test('fails closed when administrative endpoint is not HTTPS', () => {
    process.env.LIVEKIT_API_URL = 'wss://project.livekit.cloud';
    expect(() => env.liveKitApiUrl()).toThrow(/must use https:\/\//);
  });

  test('requires svc_video database credentials for video runtime', () => {
    delete process.env.DATABASE_URL_VIDEO;
    expect(() => env.videoDatabaseUrl()).toThrow(/DATABASE_URL_VIDEO/);
  });
});
