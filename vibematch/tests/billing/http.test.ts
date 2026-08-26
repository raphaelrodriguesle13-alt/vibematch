import fastify from 'fastify';
import { jest } from '@jest/globals';

import { registerBillingRoutes } from '../../backend/src/billing/http';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

const entitlement = {
  userId,
  plan: 'premium_monthly',
  status: 'ACTIVE' as const,
  currentPeriodEnd: new Date('2026-09-26T00:00:00.000Z'),
  entitled: true,
};

const buildDeps = () => ({
  service: {
    getEntitlement: jest.fn((): Promise<typeof entitlement | null> => Promise.resolve(entitlement)),
    verifyPurchase: jest.fn(() => Promise.resolve(entitlement)),
    processRtdn: jest.fn(() => Promise.resolve({ duplicate: false, entitlement })),
  },
  sessionTokenVerifier: {
    verify: jest.fn(() => Promise.resolve({ userId, sessionId, phoneVerified: true })),
  },
  activeSessionStore: {
    findActiveSession: jest.fn(() => Promise.resolve({ id: sessionId })),
    touchSession: jest.fn(() => Promise.resolve()),
  },
  rtdnVerifier: {
    verifyAuthorizationHeader: jest.fn(() => Promise.resolve()),
  },
  googlePlayPackageName: 'com.vibematch.app',
  now: () => new Date('2026-08-26T23:00:00.000Z'),
});

const rtdnBody = () => ({
  message: {
    messageId: 'message-1',
    data: Buffer.from(
      JSON.stringify({
        packageName: 'com.vibematch.app',
        eventTimeMillis: '1787785200000',
        subscriptionNotification: {
          notificationType: 3,
          purchaseToken: 'purchase-token-1',
        },
      }),
    ).toString('base64'),
  },
});

describe('billing HTTP routes', () => {
  it('verifies a purchase only for an authenticated active session', async () => {
    const app = fastify();
    const deps = buildDeps();
    registerBillingRoutes(app, deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/billing/verify-purchase',
      headers: { authorization: 'Bearer session-token' },
      payload: { purchase_token: 'purchase-token-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(deps.service.verifyPurchase).toHaveBeenCalledWith(userId, 'purchase-token-1');
    expect(response.json()).toEqual({
      data: {
        entitled: true,
        plan: 'premium_monthly',
        status: 'ACTIVE',
        current_period_end: '2026-09-26T00:00:00.000Z',
      },
    });
    await app.close();
  });

  it('returns no entitlement without granting premium locally', async () => {
    const app = fastify();
    const deps = buildDeps();
    deps.service.getEntitlement.mockResolvedValueOnce(null);
    registerBillingRoutes(app, deps);

    const response = await app.inject({
      method: 'GET',
      url: '/api/billing/entitlement',
      headers: { authorization: 'Bearer session-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        entitled: false,
        plan: null,
        status: null,
        current_period_end: null,
      },
    });
    await app.close();
  });

  it('rejects unauthenticated RTDN before processing billing state', async () => {
    const app = fastify();
    const deps = buildDeps();
    deps.rtdnVerifier.verifyAuthorizationHeader.mockRejectedValueOnce(new Error('bad identity'));
    registerBillingRoutes(app, deps);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/google-play/rtdn',
      headers: { authorization: 'Bearer forged-token' },
      payload: rtdnBody(),
    });

    expect(response.statusCode).toBe(401);
    expect(deps.service.processRtdn).not.toHaveBeenCalled();
    await app.close();
  });

  it('processes authenticated RTDN after package validation', async () => {
    const app = fastify();
    const deps = buildDeps();
    registerBillingRoutes(app, deps);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/google-play/rtdn',
      headers: { authorization: 'Bearer google-signed-token' },
      payload: rtdnBody(),
    });

    expect(response.statusCode).toBe(200);
    expect(deps.service.processRtdn).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationId: 'message-1',
        purchaseToken: 'purchase-token-1',
        notificationType: '3',
      }),
    );
    await app.close();
  });
});
