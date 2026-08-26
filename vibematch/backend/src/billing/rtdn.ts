import { OAuth2Client } from 'google-auth-library';

export type PubSubPushVerifierConfig = {
  audience: string;
  expectedServiceAccountEmail: string;
  client?: Pick<OAuth2Client, 'verifyIdToken'>;
};

export class PubSubPushVerifier {
  private readonly client: Pick<OAuth2Client, 'verifyIdToken'>;

  constructor(private readonly config: PubSubPushVerifierConfig) {
    if (!config.audience.trim()) throw new Error('Pub/Sub audience is required');
    if (!config.expectedServiceAccountEmail.trim()) {
      throw new Error('Pub/Sub service account email is required');
    }
    this.client = config.client ?? new OAuth2Client();
  }

  async verifyAuthorizationHeader(authorization: string | undefined): Promise<void> {
    if (!authorization) throw new Error('Missing Pub/Sub authorization');
    const [scheme, token, ...rest] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
      throw new Error('Invalid Pub/Sub authorization');
    }

    const ticket = await this.client.verifyIdToken({
      idToken: token,
      audience: this.config.audience,
    });
    const payload = ticket.getPayload();
    if (!payload) throw new Error('Missing Pub/Sub identity payload');
    if (payload.email_verified !== true) throw new Error('Pub/Sub identity email is not verified');
    if (payload.email !== this.config.expectedServiceAccountEmail.trim()) {
      throw new Error('Unexpected Pub/Sub service account');
    }
  }
}

export type ParsedRtdn = {
  notificationId: string;
  purchaseToken: string;
  notificationType: string;
  eventTime: Date;
};

type PubSubEnvelope = {
  message?: {
    data?: unknown;
    messageId?: unknown;
  };
};

type GooglePlayRtdn = {
  packageName?: unknown;
  eventTimeMillis?: unknown;
  subscriptionNotification?: {
    notificationType?: unknown;
    purchaseToken?: unknown;
  };
};

export const parseRtdnEnvelope = (body: unknown, expectedPackageName: string): ParsedRtdn => {
  if (!body || typeof body !== 'object') throw new Error('RTDN envelope is invalid');
  const envelope = body as PubSubEnvelope;
  const messageId = envelope.message?.messageId;
  const data = envelope.message?.data;
  if (typeof messageId !== 'string' || !messageId.trim() || typeof data !== 'string') {
    throw new Error('RTDN Pub/Sub message is invalid');
  }

  let decoded: GooglePlayRtdn;
  try {
    decoded = JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as GooglePlayRtdn;
  } catch {
    throw new Error('RTDN data is not valid base64 JSON');
  }

  if (decoded.packageName !== expectedPackageName.trim()) {
    throw new Error('RTDN package name mismatch');
  }
  const notification = decoded.subscriptionNotification;
  if (!notification) throw new Error('RTDN subscription notification is missing');
  if (
    typeof notification.purchaseToken !== 'string' ||
    !notification.purchaseToken.trim() ||
    (typeof notification.notificationType !== 'number' &&
      typeof notification.notificationType !== 'string')
  ) {
    throw new Error('RTDN subscription notification is invalid');
  }

  const eventMillis =
    typeof decoded.eventTimeMillis === 'string' || typeof decoded.eventTimeMillis === 'number'
      ? Number(decoded.eventTimeMillis)
      : Number.NaN;
  const eventTime = new Date(eventMillis);
  if (!Number.isFinite(eventMillis) || Number.isNaN(eventTime.getTime())) {
    throw new Error('RTDN event time is invalid');
  }

  return {
    notificationId: messageId.trim(),
    purchaseToken: notification.purchaseToken.trim(),
    notificationType: String(notification.notificationType),
    eventTime,
  };
};
