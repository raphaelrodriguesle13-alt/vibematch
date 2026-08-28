import type { AuthRateLimiter, AuthRateLimitScope } from '../../backend/src/auth/rate-limit';
import type { AuthSession } from '../../backend/src/auth/repository';
import type { GoogleLoginResult } from '../../backend/src/auth/service';
import type { SessionTokenClaims, SessionTokenVerifier } from '../../backend/src/shared/providers';
import { buildApp, type ActiveSessionStore } from '../../backend/src/http/app';

class FakeRateLimiter implements AuthRateLimiter {
  decision = { allowed: true, retryAfterSeconds: 30 };
  error: Error | null = null;
  calls: Array<{ scope: AuthRateLimitScope; keyMaterial: string | null; now: Date }> = [];

  consume(scope: AuthRateLimitScope, keyMaterial: string | null, now: Date) {
    this.calls.push({ scope, keyMaterial, now });
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.decision);
  }
}

class FakeTokenVerifier implements SessionTokenVerifier {
  verify(): Promise<SessionTokenClaims> {
    return Promise.resolve({ userId: 'user-1', sessionId: 'session-1', phoneVerified: false });
  }
}

class FakeSessionStore implements ActiveSessionStore {
  findActiveSession(): Promise<AuthSession | null> {
    return Promise.resolve(null);
  }

  touchSession(): Promise<void> {
    return Promise.resolve();
  }
}

const fixedNow = new Date('2026-08-28T22:00:00.000Z');

const loginResult: GoogleLoginResult = {
  sessionJwt: 'signed-jwt',
  refreshToken: 'refresh-token-that-is-long-enough-for-login',
  userId: 'user-1',
  isNewUser: false,
  phoneVerified: false,
  sessionId: 'session-1',
  expiresAt: new Date('2026-08-28T22:15:00.000Z'),
  refreshExpiresAt: new Date('2026-09-27T22:00:00.000Z'),
};

const createSubject = () => {
  const rateLimiter = new FakeRateLimiter();
  let loginCalls = 0;
  const app = buildApp({
    authService: {
      loginWithGoogle: () => {
        loginCalls += 1;
        return Promise.resolve(loginResult);
      },
      logout: () => Promise.resolve({ ok: true }),
    },
    sessionTokenVerifier: new FakeTokenVerifier(),
    activeSessionStore: new FakeSessionStore(),
    authRateLimiter: rateLimiter,
    now: () => fixedNow,
  });

  return { app, rateLimiter, loginCalls: () => loginCalls };
};

describe('Google login distributed rate limit', () => {
  test('rate limits before Google OIDC verification and emits Retry-After', async () => {
    const { app, rateLimiter, loginCalls } = createSubject();
    rateLimiter.decision = { allowed: false, retryAfterSeconds: 17 };

    const response = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { google_id_token: 'google-token-sensitive' },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('17');
    expect(response.json()).toEqual({ error: 'RATE_LIMITED' });
    expect(loginCalls()).toBe(0);
    expect(rateLimiter.calls).toEqual([
      { scope: 'GOOGLE_LOGIN', keyMaterial: 'google-token-sensitive', now: fixedNow },
    ]);
    await app.close();
  });

  test('fails closed before Google OIDC verification if limiter storage is unavailable', async () => {
    const { app, rateLimiter, loginCalls } = createSubject();
    rateLimiter.error = new Error('database unavailable');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { google_id_token: 'google-token-sensitive' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'AUTH_RATE_LIMIT_UNAVAILABLE' });
    expect(loginCalls()).toBe(0);
    await app.close();
  });

  test('allows Google login after the limiter approves the request', async () => {
    const { app, rateLimiter, loginCalls } = createSubject();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { google_id_token: 'google-token-sensitive' },
    });

    expect(response.statusCode).toBe(200);
    expect(loginCalls()).toBe(1);
    expect(rateLimiter.calls[0]?.scope).toBe('GOOGLE_LOGIN');
    await app.close();
  });
});
