import type {
  GoogleIdentity,
  GoogleIdentityProvider,
  SessionTokenClaims,
  SessionTokenProvider,
} from '../../backend/src/shared/providers';
import type { AuthSession, AuthUser } from '../../backend/src/auth/repository';
import { AuthService, type AuthRepositoryPort } from '../../backend/src/auth/service';

class FakeGoogleIdentityProvider implements GoogleIdentityProvider {
  identity: GoogleIdentity = { subject: 'google-subject' };
  error: Error | null = null;

  verifyIdToken(): Promise<GoogleIdentity> {
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.identity);
  }
}

class FakeSessionTokenProvider implements SessionTokenProvider {
  issuedClaims: SessionTokenClaims | null = null;
  issuedExpiresAt: Date | null = null;
  error: Error | null = null;

  issue(claims: SessionTokenClaims, expiresAt: Date): Promise<string> {
    this.issuedClaims = claims;
    this.issuedExpiresAt = expiresAt;
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve('signed-session-jwt');
  }
}

class FakeAuthRepository implements AuthRepositoryPort {
  user: AuthUser = {
    id: 'user-1',
    googleSubjectId: 'google-subject',
    phoneVerified: false,
    status: 'ACTIVE',
    isNewUser: true,
  };
  session: AuthSession = {
    id: 'session-1',
    userId: 'user-1',
    expiresAt: new Date('2026-08-25T22:30:00.000Z'),
    revokedAt: null,
  };
  upsertedSubject: string | null = null;
  createdSession: { userId: string; expiresAt: Date } | null = null;
  revokedSession: { userId: string; sessionId: string; revokedAt: Date } | null = null;

  upsertGoogleUser(googleSubjectId: string): Promise<AuthUser> {
    this.upsertedSubject = googleSubjectId;
    return Promise.resolve(this.user);
  }

  createSession(userId: string, expiresAt: Date): Promise<AuthSession> {
    this.createdSession = { userId, expiresAt };
    return Promise.resolve({ ...this.session, userId, expiresAt });
  }

  revokeSession(userId: string, sessionId: string, revokedAt: Date): Promise<boolean> {
    this.revokedSession = { userId, sessionId, revokedAt };
    return Promise.resolve(true);
  }
}

const fixedNow = new Date('2026-08-25T22:00:00.000Z');

const createSubject = () => {
  const repository = new FakeAuthRepository();
  const google = new FakeGoogleIdentityProvider();
  const tokens = new FakeSessionTokenProvider();
  const service = new AuthService(repository, google, tokens, {
    sessionTtlSeconds: 1800,
    now: () => fixedNow,
  });
  return { repository, google, tokens, service };
};

describe('AuthService', () => {
  test('rejects an invalid Google ID token before touching the database', async () => {
    const { repository, google, service } = createSubject();
    google.error = new Error('invalid signature');

    await expect(service.loginWithGoogle('bad-token')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });
    expect(repository.upsertedSubject).toBeNull();
  });

  test('blocks login for a suspended account', async () => {
    const { repository, service } = createSubject();
    repository.user = { ...repository.user, status: 'SUSPENDED', isNewUser: false };

    await expect(service.loginWithGoogle('valid-token')).rejects.toMatchObject({
      code: 'ACCOUNT_UNAVAILABLE',
    });
    expect(repository.createdSession).toBeNull();
  });

  test('creates a short revocable session and signs claims server-side', async () => {
    const { repository, tokens, service } = createSubject();

    const result = await service.loginWithGoogle('valid-token');

    expect(repository.upsertedSubject).toBe('google-subject');
    expect(repository.createdSession).toEqual({
      userId: 'user-1',
      expiresAt: new Date('2026-08-25T22:30:00.000Z'),
    });
    expect(tokens.issuedClaims).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      phoneVerified: false,
    });
    expect(result).toMatchObject({
      sessionJwt: 'signed-session-jwt',
      userId: 'user-1',
      isNewUser: true,
      phoneVerified: false,
      sessionId: 'session-1',
    });
  });

  test('revokes the just-created session if signing fails', async () => {
    const { repository, tokens, service } = createSubject();
    tokens.error = new Error('signer unavailable');

    await expect(service.loginWithGoogle('valid-token')).rejects.toMatchObject({
      code: 'SESSION_ISSUANCE_FAILED',
    });
    expect(repository.revokedSession).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      revokedAt: fixedNow,
    });
  });

  test('logout revokes the caller session idempotently', async () => {
    const { repository, service } = createSubject();

    await expect(service.logout('user-1', 'session-1')).resolves.toEqual({ ok: true });
    expect(repository.revokedSession).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      revokedAt: fixedNow,
    });
  });
});
