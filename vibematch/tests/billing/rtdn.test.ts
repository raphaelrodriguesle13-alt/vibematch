import type { OAuth2Client } from 'google-auth-library';
import { PubSubPushVerifier, parseRtdnEnvelope } from '../../backend/src/billing/rtdn';

const encodedRtdn = (overrides: Record<string, unknown> = {}): string =>
  Buffer.from(
    JSON.stringify({
      packageName: 'com.vibematch.app',
      eventTimeMillis: '1787785200000',
      subscriptionNotification: {
        notificationType: 3,
        purchaseToken: 'purchase-token-1',
      },
      ...overrides,
    }),
  ).toString('base64');

describe('Google Play RTDN', () => {
  it('parses an authenticated Pub/Sub envelope into a normalized event', () => {
    const parsed = parseRtdnEnvelope(
      {
        message: {
          messageId: 'message-123',
          data: encodedRtdn(),
        },
      },
      'com.vibematch.app',
    );

    expect(parsed.notificationId).toBe('message-123');
    expect(parsed.purchaseToken).toBe('purchase-token-1');
    expect(parsed.notificationType).toBe('3');
    expect(parsed.eventTime.toISOString()).toBe('2026-08-26T23:00:00.000Z');
  });

  it('rejects RTDN for another Android package', () => {
    expect(() =>
      parseRtdnEnvelope(
        {
          message: {
            messageId: 'message-123',
            data: encodedRtdn({ packageName: 'com.attacker.app' }),
          },
        },
        'com.vibematch.app',
      ),
    ).toThrow('package name mismatch');
  });

  it('verifies audience and expected Pub/Sub service-account identity', async () => {
    const verifyIdToken = jest.fn().mockResolvedValue({
      getPayload: () => ({
        email: 'pubsub-push@example.iam.gserviceaccount.com',
        email_verified: true,
      }),
    });
    const client = { verifyIdToken } as unknown as Pick<OAuth2Client, 'verifyIdToken'>;
    const verifier = new PubSubPushVerifier({
      audience: 'https://api.example.test/webhooks/google-play/rtdn',
      expectedServiceAccountEmail: 'pubsub-push@example.iam.gserviceaccount.com',
      client,
    });

    await verifier.verifyAuthorizationHeader('Bearer signed-google-token');

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'signed-google-token',
      audience: 'https://api.example.test/webhooks/google-play/rtdn',
    });
  });

  it('rejects a valid Google token from the wrong service account', async () => {
    const client = {
      verifyIdToken: jest.fn().mockResolvedValue({
        getPayload: () => ({
          email: 'other@example.iam.gserviceaccount.com',
          email_verified: true,
        }),
      }),
    } as unknown as Pick<OAuth2Client, 'verifyIdToken'>;
    const verifier = new PubSubPushVerifier({
      audience: 'https://api.example.test/webhooks/google-play/rtdn',
      expectedServiceAccountEmail: 'pubsub-push@example.iam.gserviceaccount.com',
      client,
    });

    await expect(verifier.verifyAuthorizationHeader('Bearer signed-google-token')).rejects.toThrow(
      'Unexpected Pub/Sub service account',
    );
  });
});
