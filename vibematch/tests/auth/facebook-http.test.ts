import fastify from 'fastify';
import { registerFacebookLoginRoute } from '../../backend/src/auth/facebook-http';
import {
  ProviderAuthError,
  type ProviderLoginResult,
} from '../../backend/src/auth/provider-service';

const result: ProviderLoginResult = {
  sessionJwt: 'signed-jwt',
  refreshToken: 'refresh-token-that-is-long-enough-for-the-test',
  userId: 'user-1',
  isNewUser: true,
  phoneVerified: false,
  sessionId: 'session-1',
  expiresAt: new Date('2026-08-29T13:15:00.000Z'),
  refreshExpiresAt: new Date('2026-09-28T13:00:00.000Z'),
};

class FakeFacebookService {
  credential: string | null = null;
  error: Error | null = null;

  login(credential: string): Promise<ProviderLoginResult> {
    this.credential = credential;
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(result);
  }
}

describe('Facebook auth HTTP API', () => {
  it('keeps the endpoint fail-closed when Meta is not configured', async () => {
    const app = fastify({ logger: false });
    registerFacebookLoginRoute(app, { service: null });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/facebook',
      payload: { access_token: 'token' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'FACEBOOK_NOT_CONFIGURED' });
    await app.close();
  });

  it('rejects malformed payloads before provider validation', async () => {
    const app = fastify({ logger: false });
    const service = new FakeFacebookService();
    registerFacebookLoginRoute(app, { service });

    const response = await app.inject({ method: 'POST', url: '/auth/facebook', payload: {} });

    expect(response.statusCode).toBe(400);
    expect(service.credential).toBeNull();
    await app.close();
  });

  it('maps invalid server-validated Facebook tokens to 401', async () => {
    const app = fastify({ logger: false });
    const service = new FakeFacebookService();
    service.error = new ProviderAuthError('INVALID_PROVIDER_TOKEN', 'invalid');
    registerFacebookLoginRoute(app, { service });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/facebook',
      payload: { access_token: 'invalid-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'INVALID_FACEBOOK_TOKEN' });
    await app.close();
  });

  it('returns the common session and refresh contract after successful login', async () => {
    const app = fastify({ logger: false });
    const service = new FakeFacebookService();
    registerFacebookLoginRoute(app, { service });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/facebook',
      payload: { access_token: 'valid-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(service.credential).toBe('valid-token');
    expect(response.json()).toEqual({
      session_jwt: result.sessionJwt,
      refresh_token: result.refreshToken,
      user_id: result.userId,
      is_new_user: true,
      phone_verified: false,
      expires_at: result.expiresAt.toISOString(),
      refresh_expires_at: result.refreshExpiresAt.toISOString(),
    });
    await app.close();
  });

  it('rate limits before provider token validation', async () => {
    const app = fastify({ logger: false });
    const service = new FakeFacebookService();
    registerFacebookLoginRoute(app, {
      service,
      rateLimiter: {
        consume: () => Promise.resolve({ allowed: false, retryAfterSeconds: 30 }),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/facebook',
      payload: { access_token: 'token' },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('30');
    expect(service.credential).toBeNull();
    await app.close();
  });
});
