import { jest } from '@jest/globals';
import fastify from 'fastify';
import { registerAgeAssuranceRoutes } from '../../backend/src/profile/age-http';
import { AgeAssuranceError } from '../../backend/src/profile/age-assurance';

const claims = {
  userId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  phoneVerified: true,
};

describe('age assurance HTTP', () => {
  it('returns only the hosted verification URL from the server-side provider flow', async () => {
    const app = fastify();
    const service = {
      start: jest.fn().mockResolvedValue({
        status: 'PENDING',
        verificationUrl: 'https://verify.didit.me/session/example',
      }),
      refresh: jest.fn(),
    };
    registerAgeAssuranceRoutes(app, {
      service,
      sessionTokenVerifier: { verify: jest.fn().mockResolvedValue(claims) },
      activeSessionStore: {
        findActiveSession: jest.fn().mockResolvedValue({ id: claims.sessionId }),
        touchSession: jest.fn().mockResolvedValue(undefined),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/age-assurance/start',
      headers: { authorization: 'Bearer session-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        status: 'PENDING',
        verification_url: 'https://verify.didit.me/session/example',
      },
    });
    await app.close();
  });

  it('fails closed when the provider cannot reconcile a decision', async () => {
    const app = fastify();
    registerAgeAssuranceRoutes(app, {
      service: {
        start: jest.fn(),
        refresh: jest
          .fn()
          .mockRejectedValue(
            new AgeAssuranceError('AGE_PROVIDER_UNAVAILABLE', 'provider unavailable'),
          ),
      },
      sessionTokenVerifier: { verify: jest.fn().mockResolvedValue(claims) },
      activeSessionStore: {
        findActiveSession: jest.fn().mockResolvedValue({ id: claims.sessionId }),
        touchSession: jest.fn().mockResolvedValue(undefined),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/age-assurance/refresh',
      headers: { authorization: 'Bearer session-token' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'AGE_PROVIDER_UNAVAILABLE' });
    await app.close();
  });

  it('rejects missing authentication before calling the provider', async () => {
    const app = fastify();
    const start = jest.fn();
    registerAgeAssuranceRoutes(app, {
      service: { start, refresh: jest.fn() },
      sessionTokenVerifier: { verify: jest.fn() },
      activeSessionStore: {
        findActiveSession: jest.fn(),
        touchSession: jest.fn(),
      },
    });

    const response = await app.inject({ method: 'POST', url: '/api/age-assurance/start' });
    expect(response.statusCode).toBe(401);
    expect(start).not.toHaveBeenCalled();
    await app.close();
  });
});
