import fastify from 'fastify';
import type {
  AuthRateLimitDecision,
  AuthRateLimiter,
  AuthRateLimitScope,
} from '../../backend/src/auth/rate-limit';
import { registerRefreshRoute } from '../../backend/src/auth/refresh-http';
import type { RefreshResult } from '../../backend/src/auth/service';

class FakeRateLimiter implements AuthRateLimiter {
  calls: Array<{ scope: AuthRateLimitScope; token: string | null }> = [];
  decision: AuthRateLimitDecision = { allowed: true, retryAfterSeconds: 60 };
  error: Error | null = null;

  consume(scope: AuthRateLimitScope, refreshToken: string | null): Promise<AuthRateLimitDecision> {
    this.calls.push({ scope, token: refreshToken });
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.decision);
  }
}

class FakeAuthService {
  refreshCalls = 0;
  logoutCalls = 0;

  refresh(): Promise<RefreshResult> {
    this.refreshCalls += 1;
    return Promise.resolve({
      sessionJwt: 'jwt',
      refreshToken: 'next-refresh-token-long-enough',
      userId: 'user-1',
      phoneVerified: true,
      sessionId: 'session-1',
      expiresAt: new Date('2030-01-01T00:15:00.000Z'),
      refreshExpiresAt: new Date('2030-02-01T00:00:00.000Z'),
    });
  }

  logoutWithRefresh(): Promise<{ ok: true }> {
    this.logoutCalls += 1;
    return Promise.resolve({ ok: true });
  }
}

const subject = () => {
  const app = fastify({ logger: false });
  const rateLimiter = new FakeRateLimiter();
  const authService = new FakeAuthService();
  registerRefreshRoute(app, {
    authService,
    rateLimiter,
    now: () => new Date('2030-01-01T00:00:00.000Z'),
  });
  return { app, rateLimiter, authService };
};

describe('refresh HTTP throttling', () => {
  test('returns 429 with Retry-After before refresh service execution', async () => {
    const { app, rateLimiter, authService } = subject();
    rateLimiter.decision = { allowed: false, retryAfterSeconds: 17 };

    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: 'presented-refresh-token' },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('17');
    expect(response.json()).toEqual({ error: 'RATE_LIMITED' });
    expect(authService.refreshCalls).toBe(0);
    expect(rateLimiter.calls).toEqual([{ scope: 'REFRESH', token: 'presented-refresh-token' }]);
    await app.close();
  });

  test('rate limits malformed requests globally before validation', async () => {
    const { app, rateLimiter } = subject();

    const response = await app.inject({ method: 'POST', url: '/auth/refresh', payload: {} });

    expect(response.statusCode).toBe(400);
    expect(rateLimiter.calls).toEqual([{ scope: 'REFRESH', token: null }]);
    await app.close();
  });

  test('fails closed with 503 when throttling storage is unavailable', async () => {
    const { app, rateLimiter, authService } = subject();
    rateLimiter.error = new Error('database unavailable');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout/refresh',
      payload: { refresh_token: 'logout-refresh-token' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'RATE_LIMIT_UNAVAILABLE' });
    expect(authService.logoutCalls).toBe(0);
    expect(rateLimiter.calls).toEqual([{ scope: 'LOGOUT_REFRESH', token: 'logout-refresh-token' }]);
    await app.close();
  });
});
