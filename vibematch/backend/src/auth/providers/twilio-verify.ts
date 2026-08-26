import type { SmsVerificationProvider, SmsVerificationStart } from '../../shared/providers';

type TwilioVerifyOptions = {
  accountSid: string;
  authToken: string;
  serviceSid: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

type TwilioVerificationResponse = {
  sid?: unknown;
  status?: unknown;
};

export class TwilioVerifyProvider implements SmsVerificationProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: TwilioVerifyOptions) {
    if (!options.accountSid.trim() || !options.authToken.trim() || !options.serviceSid.trim()) {
      throw new Error('Twilio Verify credentials are required');
    }
    this.baseUrl = (options.baseUrl ?? 'https://verify.twilio.com').replace(/\/+$/, '');
    const parsed = new URL(this.baseUrl);
    if (parsed.protocol !== 'https:') throw new Error('Twilio Verify base URL must use HTTPS');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async start(_userId: string, phoneE164: string): Promise<SmsVerificationStart> {
    const body = new URLSearchParams({ To: phoneE164, Channel: 'sms' });
    const response = await this.request(
      `/v2/Services/${encodeURIComponent(this.options.serviceSid)}/Verifications`,
      body,
    );
    if (typeof response.sid !== 'string' || !response.sid.startsWith('VE')) {
      throw new Error('Twilio Verify returned an invalid verification SID');
    }
    return {
      providerVerificationId: response.sid,
      expiresAt: new Date(this.now().getTime() + 10 * 60 * 1000),
    };
  }

  async confirm(_providerVerificationId: string, code: string): Promise<boolean> {
    const body = new URLSearchParams({ Code: code });
    const response = await this.request(
      `/v2/Services/${encodeURIComponent(this.options.serviceSid)}/VerificationCheck`,
      body,
    );
    return response.status === 'approved';
  }

  private async request(path: string, body: URLSearchParams): Promise<TwilioVerificationResponse> {
    const credentials = Buffer.from(`${this.options.accountSid}:${this.options.authToken}`).toString(
      'base64',
    );
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${credentials}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!response.ok) throw new Error(`Twilio Verify request failed with ${response.status}`);
    const payload = (await response.json()) as TwilioVerificationResponse;
    return payload;
  }
}
