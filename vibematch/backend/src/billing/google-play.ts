import { GoogleAuth } from 'google-auth-library';
import type {
  BillingStatus,
  GooglePlaySubscriptionVerifier,
  VerifiedPlaySubscription,
} from './service';

export type GooglePlaySubscriptionVerifierConfig = {
  packageName: string;
  apiBaseUrl?: string;
  auth?: Pick<GoogleAuth, 'getAccessToken'>;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
};

type GooglePlaySubscriptionV2 = {
  subscriptionState?: string;
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
  }>;
};

const mapState = (state: string | undefined): BillingStatus => {
  switch (state) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
      return 'ACTIVE';
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      return 'GRACE_PERIOD';
    case 'SUBSCRIPTION_STATE_CANCELED':
    case 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED':
      return 'CANCELLED';
    case 'SUBSCRIPTION_STATE_EXPIRED':
      return 'EXPIRED';
    case 'SUBSCRIPTION_STATE_PAUSED':
    case 'SUBSCRIPTION_STATE_ON_HOLD':
      return 'REVOKED';
    default:
      return 'REVOKED';
  }
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

export class GooglePlaySubscriptionVerifierImpl implements GooglePlaySubscriptionVerifier {
  private readonly auth: Pick<GoogleAuth, 'getAccessToken'>;
  private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>;
  private readonly apiBaseUrl: string;

  constructor(private readonly config: GooglePlaySubscriptionVerifierConfig) {
    if (!config.packageName.trim()) throw new Error('Google Play package name is required');
    const baseUrl = config.apiBaseUrl ?? 'https://androidpublisher.googleapis.com';
    if (!/^https:\/\//i.test(baseUrl)) throw new Error('Google Play API URL must use HTTPS');
    this.apiBaseUrl = trimTrailingSlash(baseUrl);
    this.auth =
      config.auth ??
      new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/androidpublisher'],
      });
    this.fetcher = config.fetcher ?? ((url, init) => fetch(url, init));
  }

  async verifySubscription(purchaseToken: string): Promise<VerifiedPlaySubscription> {
    const token = purchaseToken.trim();
    if (!token) throw new Error('Google Play purchase token is required');

    const accessToken = await this.auth.getAccessToken();
    if (!accessToken) throw new Error('Google Play access token is unavailable');

    const packageName = encodeURIComponent(this.config.packageName.trim());
    const encodedToken = encodeURIComponent(token);
    const response = await this.fetcher(
      `${this.apiBaseUrl}/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${encodedToken}`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Google Play verification failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as GooglePlaySubscriptionV2;
    const validLineItems = (body.lineItems ?? [])
      .map((item) => ({
        productId: item.productId?.trim() ?? '',
        expiryTime: item.expiryTime ? new Date(item.expiryTime) : null,
      }))
      .filter(
        (item): item is { productId: string; expiryTime: Date } =>
          item.productId.length > 0 &&
          item.expiryTime !== null &&
          !Number.isNaN(item.expiryTime.getTime()),
      )
      .sort((a, b) => b.expiryTime.getTime() - a.expiryTime.getTime());

    const selected = validLineItems[0];
    if (!selected) {
      throw new Error('Google Play response did not contain a valid subscription line item');
    }

    return {
      purchaseToken: token,
      productId: selected.productId,
      status: mapState(body.subscriptionState),
      currentPeriodEnd: selected.expiryTime,
    };
  }
}
