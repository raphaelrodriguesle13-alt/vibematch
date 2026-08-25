import type { SessionTokenClaims, SessionTokenVerifier } from '../../backend/src/shared/providers';
import type { AuthSession } from '../../backend/src/auth/repository';
import { AuthError, type GoogleLoginResult } from '../../backend/src/auth/service';
import { PhoneVerificationError } from '../../backend/src/auth/phone-service';
import {
  buildApp,
  type ActiveSessionStore,
  type AuthHttpDependencies,
} from '../../backend/src/http/app';

class FakeAuthService {
  loginResult: GoogleLoginResult = {
    sessionJwt: 'signed-jwt',
    userId: 'user-1',
    isNewUser: true,
    phoneVerified: false,
    sessionId: 'session-1',
    expiresAt: new Date('2026-08-25T22:30:00.000Z'),
  };
  loginError: Error | null = null;
  loginToken: string | null = null;
  logoutArgs: { userId: string; sessionId: string } | null = null;

  loginWithGoogle(token: string): Promise<GoogleLoginResult> {
    this.loginToken = token;
    if (this.loginError) return Promise.reject(this.loginError);
    return Promise.resolve(this.loginResult);
  }

  logout(userId: string, sessionId: string): Promise<{ ok: true }> {
    this.logoutArgs = { userId, sessionId };
    return Promise.resolve({ ok: true });
  }
}

class FakeTokenVerifier implements SessionTokenVerifier {
  claims: SessionTokenClaims = {
    userId: 'user-1',
    sessionId: 'session-1',
    phoneVerified: false,
  };
  error: Error | null = null;
  token: string | null = null;

  verify(token: string): Promise<SessionTokenClaims> {
    this.token = token;
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.claims);
  }
}

class FakeSessionStore implements ActiveSessionStore {
  session: AuthSession | null = {
    id: 'session-1',
    userId: 'user-1',
    expiresAt: new Date('2026-08-25T22:30:00.000Z'),
    revokedAt: null,
  };
  touched: { userId: string; sessionId: string; seenAt: Date } | null = null;

  findActiveSession(): Promise<AuthSession | null> {
    return Promise.resolve(this.session);
  }

  touchSession(userId: string, sessionId: string, seenAt: Date): Promise<void> {
    this.touched = { userId, sessionId, seenAt };
    return Promise.resolve();
  }
}

class FakePhoneVerificationService {
  startArgs: { userId: string; phone: string } | null = null;
  confirmArgs: { userId: string; verificationId: string; code: string } | null = null;
  startError: Error | null = null;
  confirmError: Error | null = null;

  start(userId: string, phone: string): Promise<{ verificationId: string; expiresAt: Date }> {
    this.startArgs = { userId, phone };
    if (this.startError) return Promise.reject(this.startError);
    return Promise.resolve({
      verificationId: 'verification-1',
      expiresAt: new Date('2026-08-25T22:10:00.000Z'),
    });
  }

  confirm(
    userId: string,
    verificationId: string,
    code: string,
  ): Promise<{ ok: true; phoneVerified: true }> {
    this.confirmArgs = { userId, verificationId, code };
    if (this.confirmError) return Promise.reject(this.confirmError);
    return Promise.resolve({ ok: true, phoneVerified: true });
  }
}

const fixedNow = new Date('2026-08-25T22:05:00.000Z');

const createSubject = () => {
  const authService = new FakeAuthService();
  const sessionTokenVerifier = new FakeTokenVerifier();
  const activeSessionStore = new FakeSessionStore();
  const phoneVerificationService = new FakePhoneVerificationService();
  const deps: AuthHttpDependencies = {
    authService,
    sessionTokenVerifier,
    activeSessionStore,
    phoneVerificationService,
    now: () => fixedNow,
  };
  return {
    app: buildApp(deps),
    authService,
    sessionTokenVerifier,
    activeSessionStore,
    phoneVerificationService,
  };
};

describe('Auth HTTP API', () => {
  test('POST /auth/google rejects malformed input', async () => {
    const { app } = createSubject();
    const response = await app.inject({ method: 'POST', url: '/auth/google', payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'INVALID_REQUEST' });
    await app.close();
  });

  test('POST /auth/google maps invalid Google token to 401', async () => {
    const { app, authService } = createSubject();
    authService.loginError = new AuthError('INVALID_GOOGLE_TOKEN', 'invalid');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { google_id_token: 'bad-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'INVALID_GOOGLE_TOKEN' });
    await app.close();
  });

  test('POST /auth/google returns the Blueprint response contract', async () => {
    const { app, authService } = createSubject();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { google_id_token: 'google-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(authService.loginToken).toBe('google-token');
    expect(response.json()).toEqual({
      session_jwt: 'signed-jwt',
      user_id: 'user-1',
      is_new_user: true,
      phone_verified: false,
      expires_at: '2026-08-25T22:30:00.000Z',
    });
    await app.close();
  });

  test('POST /auth/logout requires a Bearer token', async () => {
    const { app } = createSubject();
    const response = await app.inject({ method: 'POST', url: '/auth/logout' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'UNAUTHORIZED' });
    await app.close();
  });

  test('POST /auth/logout rejects a revoked or expired database session', async () => {
    const { app, activeSessionStore } = createSubject();
    activeSessionStore.session = null;

    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: 'Bearer signed-jwt' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'SESSION_REVOKED_OR_EXPIRED' });
    await app.close();
  });

  test('POST /auth/logout validates JWT + DB session then revokes it', async () => {
    const { app, authService, sessionTokenVerifier, activeSessionStore } = createSubject();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: 'Bearer signed-jwt' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(sessionTokenVerifier.token).toBe('signed-jwt');
    expect(activeSessionStore.touched).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      seenAt: fixedNow,
    });
    expect(authService.logoutArgs).toEqual({ userId: 'user-1', sessionId: 'session-1' });
    await app.close();
  });

  test('POST /auth/phone/start requires an active session and returns verification metadata', async () => {
    const { app, phoneVerificationService } = createSubject();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/phone/start',
      headers: { authorization: 'Bearer signed-jwt' },
      payload: { phone_e164: '+5511999999999' },
    });

    expect(response.statusCode).toBe(200);
    expect(phoneVerificationService.startArgs).toEqual({
      userId: 'user-1',
      phone: '+5511999999999',
    });
    expect(response.json()).toEqual({
      verification_id: 'verification-1',
      expires_at: '2026-08-25T22:10:00.000Z',
    });
    await app.close();
  });

  test('POST /auth/phone/start maps invalid phone to 400', async () => {
    const { app, phoneVerificationService } = createSubject();
    phoneVerificationService.startError = new PhoneVerificationError(
      'INVALID_PHONE',
      'invalid phone',
    );

    const response = await app.inject({
      method: 'POST',
      url: '/auth/phone/start',
      headers: { authorization: 'Bearer signed-jwt' },
      payload: { phone_e164: '11999999999' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'INVALID_PHONE' });
    await app.close();
  });

  test('POST /auth/phone/confirm marks phone verified and maps attempt limits', async () => {
    const { app, phoneVerificationService } = createSubject();
    const success = await app.inject({
      method: 'POST',
      url: '/auth/phone/confirm',
      headers: { authorization: 'Bearer signed-jwt' },
      payload: { verification_id: 'verification-1', code: '123456' },
    });

    expect(success.statusCode).toBe(200);
    expect(phoneVerificationService.confirmArgs).toEqual({
      userId: 'user-1',
      verificationId: 'verification-1',
      code: '123456',
    });
    expect(success.json()).toEqual({ ok: true, phone_verified: true });

    phoneVerificationService.confirmError = new PhoneVerificationError(
      'TOO_MANY_ATTEMPTS',
      'locked',
    );
    const locked = await app.inject({
      method: 'POST',
      url: '/auth/phone/confirm',
      headers: { authorization: 'Bearer signed-jwt' },
      payload: { verification_id: 'verification-1', code: '000000' },
    });

    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toEqual({ error: 'TOO_MANY_ATTEMPTS' });
    await app.close();
  });
});
