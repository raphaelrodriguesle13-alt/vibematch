import { jest } from '@jest/globals';
import { createHmac } from 'node:crypto';
import fastify from 'fastify';
import { registerAgeWebhookRoute } from '../../backend/src/profile/age-webhook-http';
import { verifyDiditWebhookV2 } from '../../backend/src/profile/didit-webhook';

const secret = 'test-webhook-secret-not-production';
const now = new Date('2026-08-27T12:00:00.000Z');
const timestamp = String(Math.floor(now.getTime() / 1000));
const body: Record<string, unknown> = {
  webhook_type: 'status.updated',
  status: 'Approved',
  session_id: 'provider-session-1',
  timestamp: Number(timestamp),
};

const signatureFor = (payload: Record<string, unknown>): string => {
  const canonical = JSON.stringify(
    Object.keys(payload)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = payload[key];
        return result;
      }, {}),
  );
  return createHmac('sha256', secret).update(canonical).digest('hex');
};

describe('Didit V3 webhook security', () => {
  it('accepts a valid V2 signature inside the replay window', () => {
    expect(verifyDiditWebhookV2(body, signatureFor(body), timestamp, secret, now)).toBe(true);
  });

  it('rejects invalid signatures and stale timestamps', () => {
    expect(verifyDiditWebhookV2(body, 'invalid', timestamp, secret, now)).toBe(false);
    const stale = String(Number(timestamp) - 301);
    expect(verifyDiditWebhookV2(body, signatureFor(body), stale, secret, now)).toBe(false);
  });

  it('authenticates before reconciling and ignores webhook decision as authority', async () => {
    const app = fastify();
    const reconcileProviderSession = jest.fn().mockResolvedValue({
      outcome: 'APPLIED',
      status: 'APPROVED',
    });
    registerAgeWebhookRoute(app, {
      webhookSecret: secret,
      reconciler: { reconcileProviderSession },
      now: () => now,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/age-assurance/webhook',
      headers: {
        'x-signature-v2': signatureFor(body),
        'x-timestamp': timestamp,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(reconcileProviderSession).toHaveBeenCalledWith('provider-session-1');
    expect(reconcileProviderSession).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('rejects unauthenticated requests before reconciliation', async () => {
    const app = fastify();
    const reconcileProviderSession = jest.fn();
    registerAgeWebhookRoute(app, {
      webhookSecret: secret,
      reconciler: { reconcileProviderSession },
      now: () => now,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/age-assurance/webhook',
      payload: body,
    });

    expect(response.statusCode).toBe(401);
    expect(reconcileProviderSession).not.toHaveBeenCalled();
    await app.close();
  });

  it('requests provider retry when the session is not persisted yet', async () => {
    const app = fastify();
    registerAgeWebhookRoute(app, {
      webhookSecret: secret,
      reconciler: {
        reconcileProviderSession: jest.fn().mockResolvedValue({ outcome: 'SESSION_NOT_FOUND' }),
      },
      now: () => now,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/age-assurance/webhook',
      headers: {
        'x-signature-v2': signatureFor(body),
        'x-timestamp': timestamp,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'AGE_SESSION_NOT_READY' });
    await app.close();
  });

  it('fails closed when server-to-server reconciliation fails', async () => {
    const app = fastify();
    registerAgeWebhookRoute(app, {
      webhookSecret: secret,
      reconciler: {
        reconcileProviderSession: jest.fn().mockRejectedValue(new Error('provider timeout')),
      },
      now: () => now,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/age-assurance/webhook',
      headers: {
        'x-signature-v2': signatureFor(body),
        'x-timestamp': timestamp,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'AGE_PROVIDER_UNAVAILABLE' });
    await app.close();
  });
});
