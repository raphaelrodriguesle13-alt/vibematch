import { Pool } from 'pg';
import { env } from '../config/env';
import { LiveKitRoomAdmin } from './livekit-room-admin';
import { LiveKitTokenProvider } from './livekit-token-provider';
import { VideoSessionRepository } from './repository';
import { VideoRevocationRepository, VideoRevocationService } from './revocation-service';
import { VideoSessionService } from './service';

export type VideoRuntime = {
  sessionService: VideoSessionService;
  revocationService: VideoRevocationService;
  rtcUrl: string;
  checkReady(): Promise<boolean>;
  close(): Promise<void>;
};

/**
 * Production composition root for the video boundary.
 *
 * Security properties:
 * - runtime DB access uses DATABASE_URL_VIDEO / svc_video, never owner credentials;
 * - participant and admin JWTs share server-only LiveKit credentials;
 * - RTC and administrative endpoints are distinct and protocol-validated;
 * - callers receive only the public RTC URL, never API secret/key material.
 */
export const createVideoRuntime = (): VideoRuntime => {
  const pool = new Pool({ connectionString: env.videoDatabaseUrl() });
  const apiKey = env.liveKitApiKey();
  const apiSecret = env.liveKitApiSecret();

  const sessionRepository = new VideoSessionRepository(pool);
  const tokenProvider = new LiveKitTokenProvider({ apiKey, apiSecret });
  const roomAdmin = new LiveKitRoomAdmin({
    baseUrl: env.liveKitApiUrl(),
    apiKey,
    apiSecret,
  });
  const revocationRepository = new VideoRevocationRepository(pool);

  return {
    sessionService: new VideoSessionService(sessionRepository, tokenProvider),
    revocationService: new VideoRevocationService(revocationRepository, roomAdmin),
    rtcUrl: env.liveKitRtcUrl(),
    checkReady: async () => {
      await pool.query('SELECT 1');
      return true;
    },
    close: () => pool.end(),
  };
};
