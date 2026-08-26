import { SignJWT } from 'jose';
import type { VideoTokenProvider } from './service';

export type LiveKitTokenProviderConfig = {
  apiKey: string;
  apiSecret: string;
  now?: () => Date;
};

/**
 * Server-only LiveKit join-token signer.
 *
 * Security properties:
 * - identity is the opaque VibeMatch user UUID, never client supplied;
 * - room is the server-generated session room, never client supplied;
 * - roomJoin is the only administrative room grant;
 * - token lifetime is short and bounded;
 * - the API secret never leaves the backend.
 *
 * This implements LiveKit's documented JWT access-token shape without exposing
 * provider details to the VideoSessionService domain boundary.
 */
export class LiveKitTokenProvider implements VideoTokenProvider {
  private readonly key: Uint8Array;
  private readonly now: () => Date;

  constructor(private readonly config: LiveKitTokenProviderConfig) {
    if (!config.apiKey.trim()) throw new Error('LiveKit API key is required');
    if (!config.apiSecret.trim()) throw new Error('LiveKit API secret is required');
    this.key = new TextEncoder().encode(config.apiSecret);
    this.now = config.now ?? (() => new Date());
  }

  async issueParticipantToken(input: {
    sessionId: string;
    roomName: string;
    userId: string;
    ttlSeconds: number;
  }): Promise<string> {
    if (!input.sessionId || !input.roomName || !input.userId) {
      throw new Error('LiveKit token input is incomplete');
    }

    // Defense in depth: the service currently requests 120 seconds. Keep the
    // provider unable to mint a long-lived participant credential by mistake.
    if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > 300) {
      throw new Error('LiveKit participant token TTL must be between 1 and 300 seconds');
    }

    const issuedAt = Math.floor(this.now().getTime() / 1000);

    return new SignJWT({
      video: {
        room: input.roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
      metadata: JSON.stringify({ session_id: input.sessionId }),
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(this.config.apiKey)
      .setSubject(input.userId)
      .setIssuedAt(issuedAt)
      .setNotBefore(issuedAt - 5)
      .setExpirationTime(issuedAt + input.ttlSeconds)
      .sign(this.key);
  }
}
