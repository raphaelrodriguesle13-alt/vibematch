import { jest } from '@jest/globals';
import fastify from 'fastify';
import type { AuthSession } from '../../backend/src/auth/repository';
import {
  registerAgeAssuranceRoutes,
  type AgeAssuranceHttpDependencies,
} from '../../backend/src/profile/age-http';
import { AgeAssuranceError } from '../../backend/src/profile/age-assurance';

const claims = {
  userId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  phoneVerified: true,
};

const activeSession: AuthSession = {
  id: claims.sessionId,
  userId: claims.userId,
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  revokedAt: null,
};

const authDeps = (): Pick<
  AgeAssuranceHttpDependencies,
  'sessionTokenVerifier' | 'activeSessionStore'
> => ({
  sessionTokenVerifier: { verify: async () => claims },
  activeSessionStore: {
    findActiveSession: async () => activeSession,
    touchSession: async () => undefined,
  },
});

describe('age assurance HTTP', () => {
  it('returns only the hosted verification URL from the server-side provider flow', async () => {
    const app = fastify();
    const service: AgeAssuranceHttpDependencies['service'] = {
      start: jest.fn(async () => ({
        status: 'PENDING' as const,
        verificationUrl: 'https://verify.didit.me/session/example',
      })),
      refresh: jest.fn(async () => 'PENDING' as const),
    };
    registerAgeAssuranceRoutes(app, { service, ...authDeps() });

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
    const service: AgeAssuranceHttpDependencies['service'] = {
      start: jest.fn(async () => ({ status: 'PENDING' as const, verificationUrl: '' })),
      refresh: jest.fn(async () => {
        throw new AgeAssuranceError('AGE_PROVIDER_UNAVAILABLE', 'provider unavailable');
      }),
    };
    registerAgeAssuranceRoutes(app, { service, ...authDeps() });

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
    const start: AgeAssuranceHttpDependencies['service']['start'] = jest.fn(async () => ({
      status: 'PENDING',
      verificationUrl: 'https://verify.didit.me/session/example',
    }));
    registerAgeAssuranceRoutes(app, {
      service: { start, refresh: async () => 'PENDING' },
      sessionTokenVerifier: { verify: async () => claims },
      activeSessionStore: {
        findActiveSession: async () => activeSession,
        touchSession: async () => undefined,
      },
    });

    const response = await app.inject({ method: 'POST', url: '/api/age-assurance/start' });
    expect(response.statusCode).toBe(401);
    expect(start).not.toHaveBeenCalled();
    await app.close();
  });
});
