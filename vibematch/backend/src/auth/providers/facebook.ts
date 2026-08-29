export type FacebookIdentity = {
  subject: string;
};

export interface FacebookIdentityProvider {
  verifyAccessToken(accessToken: string): Promise<FacebookIdentity>;
}

type MetaFacebookIdentityProviderOptions = {
  appId: string;
  appSecret: string;
  graphBaseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

type DebugTokenPayload = {
  data?: {
    app_id?: unknown;
    is_valid?: unknown;
    user_id?: unknown;
    expires_at?: unknown;
  };
};

export class MetaFacebookIdentityProvider implements FacebookIdentityProvider {
  private readonly graphBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: MetaFacebookIdentityProviderOptions) {
    if (!options.appId.trim() || !options.appSecret.trim()) {
      throw new Error('Facebook app credentials are required');
    }
    this.graphBaseUrl = (options.graphBaseUrl ?? 'https://graph.facebook.com').replace(/\/+$/, '');
    const parsed = new URL(this.graphBaseUrl);
    if (parsed.protocol !== 'https:') throw new Error('Facebook Graph base URL must use HTTPS');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async verifyAccessToken(accessToken: string): Promise<FacebookIdentity> {
    const token = accessToken.trim();
    if (!token) throw new Error('Facebook access token is required');

    const url = new URL(`${this.graphBaseUrl}/debug_token`);
    url.searchParams.set('input_token', token);
    url.searchParams.set('access_token', `${this.options.appId}|${this.options.appSecret}`);

    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Facebook token validation failed with ${response.status}`);

    const payload = (await response.json()) as DebugTokenPayload;
    const data = payload.data;
    if (!data || data.is_valid !== true || data.app_id !== this.options.appId) {
      throw new Error('Facebook access token is invalid for this app');
    }
    if (typeof data.user_id !== 'string' || data.user_id.trim() === '') {
      throw new Error('Facebook token is missing a user id');
    }
    if (typeof data.expires_at !== 'number' || !Number.isFinite(data.expires_at)) {
      throw new Error('Facebook token is missing expiry');
    }
    if (data.expires_at * 1000 <= this.now().getTime()) {
      throw new Error('Facebook access token is expired');
    }

    return { subject: data.user_id };
  }
}
