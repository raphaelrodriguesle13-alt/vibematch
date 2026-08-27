import { createHash } from 'node:crypto';
import type { SessionTokenClaims, SessionTokenProvider } from '../../backend/src/shared/providers';
import type { AuthSession, AuthUser, RefreshRotationResult } from '../../backend/src/auth/repository';
import { AuthService, type AuthRepositoryPort } from '../../backend/src/auth/service';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

class RefreshRepository implements AuthRepositoryPort {
  rotation: RefreshRotationResult | null = {
    session: {
      id: 'session-1',
      userId: 'user-1',
      expiresAt: new Date('2026-08-27T11:15:00.000Z'),
      revokedAt: null,
    },
    phoneVerified: true,
    refreshExpiresAt: new Date('2026-09-26T11:00:00.000Z'),
    reused: false,
  };
  rotateParams: Parameters<NonNullable<AuthRepositoryPort['rotateRefreshSession']>>[0] | null = null;
  revoked: { userId: string; sessionId: string } | null = null;

  upsertGoogleUser(): Promise<AuthUser> {
    throw new Error('not used');
  }

  createSession(): Promise<AuthSession> {
    throw new Error('not used');
  }

  rotateRefreshSession(
    params: Parameters<NonNullable<AuthRepositoryPort['rotateRefreshSession']>>[0],
  ): Promise<RefreshRotationResult | null> {
    this.rotateParams = params;
    return Promise.resolve(this.rotation);
  }

  revokeSession(userId: string, sessionId: string): Promise<boolean> {
    this.revoked = { userId, sessionId };
    return Promise.resolve(true);
  }
}

class Tokens implements SessionTokenProvider {
  claims: SessionTokenClaims | null = null;
  fail = false;

  issue(claims: SessionTokenClaims): Promise<string> {
    this.claims = claims;
    return this.fail ? Promise.reject(new Error('signer down')) : Promise.resolve('rotated-jwt');
  }
}

const now = new Date('2026-08-27T11:00:00.000Z');
const oldToken = 'old-refresh-token-with-more-than-thirty-two-bytes';
const newToken = 'new-refresh-token-with-more-than-thirty-two-bytes';

const subject = () => {
  const repository = new RefreshRepository();
  const tokens = new Tokens();
  const service = new AuthService(
    repository,
    { verifyIdToken: () => Promise.resolve({ subject: 'unused' }) },
    tokens,
    {
      sessionTtlSeconds: 15 * 60,
      refreshTtlSeconds: 30 * 24 * 60 * 60,
      now: () => now,
      refreshToken: () => newToken,
    },
  );
  return { repository, tokens, service };
};

describe('Auth refresh rotation', () => {
  test('hashes the presented token, rotates it and issues a fresh access JWT', async () => {
    const { repository, tokens, service } = subject();

    const result = await service.refresh(oldToken);

    expect(repository.rotateParams).toEqual({
      presentedHash: sha256(oldToken),
      replacementHash: sha256(newToken),
      accessExpiresAt: new Date('2026-08-27T11:15:00.000Z'),
      now,
    });
    expect(tokens.claims).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      phoneVerified: true,
    });
    expect(result).toMatchObject({
      sessionJwt: 'rotated-jwt',
      refreshToken: newToken,
      userId: 'user-1',
      sessionId: 'session-1',
      phoneVerified: true,
    });
  });

  test('rejects an unknown refresh token without issuing JWT material', async () => {
    const { repository, tokens, service } = subject();
    repository.rotation = null;

    await expect(service.refresh(oldToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    expect(tokens.claims).toBeNull();
  });

  test('treats reuse detection as invalid and relies on repository revocation', async () => {
    const { repository, tokens, service } = subject();
    repository.rotation = { ...repository.rotation!, reused: true };

    await expect(service.refresh(oldToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    expect(tokens.claims).toBeNull();
  });

  test('revokes the session if signing the rotated access JWT fails', async () => {
    const { repository, tokens, service } = subject();
    tokens.fail = true;

    await expect(service.refresh(oldToken)).rejects.toMatchObject({ code: 'SESSION_ISSUANCE_FAILED' });
    expect(repository.revoked).toEqual({ userId: 'user-1', sessionId: 'session-1' });
  });
});
