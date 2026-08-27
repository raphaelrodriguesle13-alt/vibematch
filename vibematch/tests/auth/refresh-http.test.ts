import fastify from 'fastify';
import { registerRefreshRoute } from '../../backend/src/auth/refresh-http';
import { AuthError, type RefreshResult } from '../../backend/src/auth/service';

class FakeRefreshService {
  token: string | null = null;
  logoutToken: string | null = null;
  error: Error | null = null;
  logoutError: Error | null = null;
  result: RefreshResult = {
    sessionJwt: 'rotated-jwt',
    refreshToken: 'rotated-refresh-token-that-is-long-enough',
    userId: 'user-1',
    phoneVerified: true,
    sessionId: 'session-1',
    expiresAt: new Date('2026-08-27T16:00:00.000Z'),
    refreshExpiresAt: new Date('2026-09-26T15:45:00.000Z'),
  };

  refresh(token: string): Promise<RefreshResult> {
    this.token = token;
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.result);
  }

  logoutWithRefresh(token: string): Promise<{ ok: true }> {
    this.logoutToken = token;
    if (this.logoutError) return Promise.reject(this.logoutError);
    return Promise.resolve({ ok: true });
  }
}

const subject = () => {
  const app = fastify({ logger: false });
  const authService = new FakeRefreshService();
  registerRefreshRoute(app, { authService });
  return { app, authService };
};

describe('Auth refresh HTTP API', () => {
  test('rejects a missing refresh token before calling the service', async () => {
    const { app, authService } = subject();
    const response = await app.inject({ method: 'POST', url: '/auth/refresh', payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'INVALID_REQUEST' });
    expect(authService.token).toBeNull();
    await app.close();
  });

  test('returns both rotated credentials and absolute expiries', async () => {
    const { app, authService } = subject();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: 'presented-refresh-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(authService.token).toBe('presented-refresh-token');
    expect(response.json()).toEqual({
      session_jwt: 'rotated-jwt',
      refresh_token: 'rotated-refresh-token-that-is-long-enough',
      user_id: 'user-1',
      phone_verified: true,
      expires_at: '2026-08-27T16:00:00.000Z',
      refresh_expires_at: '2026-09-26T15:45:00.000Z',
    });
    await app.close();
  });

  test('maps invalid or replayed refresh credentials to 401', async () => {
    const { app, authService } = subject();
    authService.error = new AuthError('INVALID_REFRESH_TOKEN', 'invalid');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: 'replayed-refresh-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'INVALID_REFRESH_TOKEN' });
    await app.close();
  });

  test('fails closed when rotated session issuance fails', async () => {
    const { app, authService } = subject();
    authService.error = new AuthError('SESSION_ISSUANCE_FAILED', 'signer unavailable');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: 'valid-refresh-token' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'SESSION_ISSUANCE_FAILED' });
    await app.close();
  });

  test('revokes with a refresh credential without requiring a live access JWT', async () => {
    const { app, authService } = subject();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout/refresh',
      payload: { refresh_token: 'logout-refresh-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(authService.logoutToken).toBe('logout-refresh-token');
    await app.close();
  });

  test('does not reveal whether a refresh logout credential existed', async () => {
    const { app, authService } = subject();
    authService.logoutError = new Error('database lookup failed');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout/refresh',
      payload: { refresh_token: 'unknown-refresh-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });

  test('rejects malformed refresh logout payloads without token oracle behavior', async () => {
    const { app, authService } = subject();
    const response = await app.inject({ method: 'POST', url: '/auth/logout/refresh', payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'INVALID_REQUEST' });
    expect(authService.logoutToken).toBeNull();
    await app.close();
  });
});
