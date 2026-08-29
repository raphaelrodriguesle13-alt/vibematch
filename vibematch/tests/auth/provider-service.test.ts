import type { IdentityUser } from '../../backend/src/auth/identity-repository';
import {
  ProviderAuthService,
  type ExternalIdentityVerifier,
  type ProviderIdentityRepositoryPort,
  type ProviderSessionRepositoryPort,
} from '../../backend/src/auth/provider-service';
import type { AuthSession } from '../../backend/src/auth/repository';
import type {
  SessionTokenClaims,
  SessionTokenProvider,
} from '../../backend/src/shared/providers';

class FakeVerifier implements ExternalIdentityVerifier {
  subject = 'facebook-subject';
  error: Error | null = null;

  verifyCredential(): Promise<{ subject: string }> {
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve({ subject: this.subject });
  }
}

class FakeIdentityRepository implements ProviderIdentityRepositoryPort {
  user: IdentityUser = {
    id: 'user-1',
    phoneVerified: false,
    status: 'ACTIVE',
    isNewUser: true,
  };
  lookup: { provider: string; subject: string } | null = null;

  findOrCreateUser(
    provider: 'GOOGLE' | 'FACEBOOK' | 'PHONE',
    subject: string,
  ): Promise<IdentityUser> {
    this.lookup = { provider, subject };
    return Promise.resolve(this.user);
  }
}

class FakeSessionRepository implements ProviderSessionRepositoryPort {
  created:
    | {
        userId: string;
        expiresAt: Date;
        refreshTokenHash: string | undefined;
        refreshExpiresAt: Date | undefined;
      }
    | null = null;
  revoked: { userId: string; sessionId: string; revokedAt: Date } | null = null;

  createSession(
    userId: string,
    expiresAt: Date,
    refreshTokenHash?: string,
    refreshExpiresAt?: Date,
  ): Promise<AuthSession> {
    this.created = { userId, expiresAt, refreshTokenHash, refreshExpiresAt };
    return Promise.resolve({ id: 'session-1', userId, expiresAt, revokedAt: null });
  }

  revokeSession(userId: string, sessionId: string, revokedAt: Date): Promise<boolean> {
    this.revoked = { userId, sessionId, revokedAt };
    return Promise.resolve(true);
  }
}

class FakeTokenProvider implements SessionTokenProvider {
  claims: SessionTokenClaims | null = null;
  error: Error | null = null;

  issue(claims: SessionTokenClaims): Promise<string> {
    this.claims = claims;
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve('signed-jwt');
  }
}

const now = new Date('2026-08-29T13:00:00.000Z');
const refreshToken = 'r'.repeat(43);

const buildService = (provider: 'FACEBOOK' | 'PHONE' = 'FACEBOOK') => {
  const verifier = new FakeVerifier();
  const identities = new FakeIdentityRepository();
  const sessions = new FakeSessionRepository();
  const tokens = new FakeTokenProvider();
  const service = new ProviderAuthService(
    provider,
    provider === 'PHONE' ? null : verifier,
    identities,
    sessions,
    tokens,
    {
      sessionTtlSeconds: 900,
      refreshTtlSeconds: 30 * 24 * 60 * 60,
      now: () => now,
      refreshToken: () => refreshToken,
    },
  );
  return { service, verifier, identities, sessions, tokens };
};

describe('ProviderAuthService', () => {
  it('validates a provider credential before creating an identity', async () => {
    const { service, verifier, identities } = buildService();
    verifier.error = new Error('bad token');

    await expect(service.login('bad-token')).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_TOKEN',
    });
    expect(identities.lookup).toBeNull();
  });

  it('uses the verified provider subject and never the presented access token as identity', async () => {
    const { service, identities } = buildService();

    await service.login('opaque-facebook-access-token');

    expect(identities.lookup).toEqual({ provider: 'FACEBOOK', subject: 'facebook-subject' });
  });

  it('stores only a hash of the refresh token and issues the common JWT claims', async () => {
    const { service, sessions, tokens } = buildService();

    const result = await service.login('valid-token');

    expect(sessions.created?.refreshTokenHash).toHaveLength(64);
    expect(sessions.created?.refreshTokenHash).not.toBe(refreshToken);
    expect(tokens.claims).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      phoneVerified: false,
    });
    expect(result.refreshToken).toBe(refreshToken);
  });

  it('blocks restricted identities before issuing a session', async () => {
    const { service, identities, sessions } = buildService();
    identities.user = { ...identities.user, status: 'SUSPENDED' };

    await expect(service.login('valid-token')).rejects.toMatchObject({
      code: 'ACCOUNT_UNAVAILABLE',
    });
    expect(sessions.created).toBeNull();
  });

  it('revokes a newly created session if JWT signing fails', async () => {
    const { service, sessions, tokens } = buildService();
    tokens.error = new Error('signer down');

    await expect(service.login('valid-token')).rejects.toMatchObject({
      code: 'SESSION_ISSUANCE_FAILED',
    });
    expect(sessions.revoked).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      revokedAt: now,
    });
  });

  it('allows a previously verified phone hash to use the same session model', async () => {
    const { service, identities } = buildService('PHONE');
    identities.user = { ...identities.user, phoneVerified: true };

    const result = await service.issueVerifiedIdentity('server-side-phone-hash');

    expect(identities.lookup).toEqual({ provider: 'PHONE', subject: 'server-side-phone-hash' });
    expect(result.phoneVerified).toBe(true);
  });
});
