import { SignJWT } from 'jose';

export type LiveKitRoomAdminConfig = {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  now?: () => Date;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

export class LiveKitRoomAdmin {
  private readonly key: Uint8Array;
  private readonly now: () => Date;
  private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>;
  private readonly baseUrl: string;

  constructor(private readonly config: LiveKitRoomAdminConfig) {
    if (!config.baseUrl.trim()) throw new Error('LiveKit URL is required');
    if (!/^https:\/\//i.test(config.baseUrl)) {
      throw new Error('LiveKit administrative URL must use HTTPS');
    }
    if (!config.apiKey.trim()) throw new Error('LiveKit API key is required');
    if (!config.apiSecret.trim()) throw new Error('LiveKit API secret is required');

    this.baseUrl = trimTrailingSlash(config.baseUrl.trim());
    this.key = new TextEncoder().encode(config.apiSecret);
    this.now = config.now ?? (() => new Date());
    this.fetcher = config.fetcher ?? ((url, init) => fetch(url, init));
  }

  async terminateRoom(roomName: string): Promise<void> {
    if (!roomName.trim()) throw new Error('LiveKit room name is required');
    const token = await this.issueAdminToken(roomName);
    const response = await this.fetcher(`${this.baseUrl}/twirp/livekit.RoomService/DeleteRoom`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ room: roomName }),
    });

    if (!response.ok) {
      throw new Error(`LiveKit room termination failed with HTTP ${response.status}`);
    }
  }

  private async issueAdminToken(roomName: string): Promise<string> {
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    return new SignJWT({
      video: {
        room: roomName,
        roomAdmin: true,
      },
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(this.config.apiKey)
      .setIssuedAt(issuedAt)
      .setNotBefore(issuedAt - 5)
      .setExpirationTime(issuedAt + 60)
      .sign(this.key);
  }
}
