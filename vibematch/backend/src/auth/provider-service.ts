import { createHash, randomBytes } from 'node:crypto';
import type { SessionTokenProvider } from '../shared/providers';
import type { AuthSession } from './repository';
import type { AuthIdentityProvider, IdentityUser } from './identity-repository';

export type ProviderAuthErrorCode =
  | 'INVALID_PROVIDER_TOKEN'
  | 'ACCOUNT_UNAVAILABLE'
  | 'SESSION_ISSUANCE_FAILED';

export class ProviderAuthError extends Error {
  constructor(
    readonly code: ProviderAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderAuthError';
  }
}

export interface ExternalIdentityVerifier {
  verifyCredential(credential: string): Promise<{ subject: string }>;
}

export interface ProviderIdentityRepositoryPort {
  findOrCreateUser(provider: AuthIdentityProvider, externalSubject: string): Promise<IdentityUser>;
}

export interface ProviderSessionRepositoryPort {
  createSession(
    userId: string,
    expiresAt: Date,
    refreshTokenHash?: string,
    refreshExpiresAt?: Date,
  ): Promise<AuthSession>;
  revokeSession(userId: string, sessionId: string, revokedAt: Date): Promise<boolean>;
}

export type ProviderLoginResult = {
  sessionJwt: string;
  refreshToken: string;
  userId: string;
  isNewUser: boolean;
  phoneVerified: boolean;
  sessionId: string;
  expiresAt: Date;
  refreshExpiresAt: Date;
};

export type ProviderAuthServiceOptions = {
  sessionTtlSeconds: number;
  refreshTtlSeconds?: number;
  now?: () => Date;
  refreshToken?: () => string;
};

const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export class ProviderAuthService {
  private readonly now: () => Date;
  private readonly refreshToken: () => string;
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly provider: AuthIdentityProvider,
    private readonly verifier: ExternalIdentityVerifier,
    private readonly identities: ProviderIdentityRepositoryPort,
    private readonly sessions: ProviderSessionRepositoryPort,
    private readonly sessionTokenProvider: SessionTokenProvider,
    private readonly options: ProviderAuthServiceOptions,
  ) {
    if (!Number.isInteger(options.sessionTtlSeconds) || options.sessionTtlSeconds <= 0) {
      throw new Error('sessionTtlSeconds must be a positive integer');
    }
    const refreshTtlSeconds = options.refreshTtlSeconds ?? 30 * 24 * 60 * 60;
    if (!Number.isInteger(refreshTtlSeconds) || refreshTtlSeconds <= options.sessionTtlSeconds) {
      throw new Error('refreshTtlSeconds must be greater than sessionTtlSeconds');
    }
    this.refreshTtlSeconds = refreshTtlSeconds;
    this.now = options.now ?? (() => new Date());
    this.refreshToken = options.refreshToken ?? (() => randomBytes(32).toString('base64url'));
  }

  async login(credential: string): Promise<ProviderLoginResult> {
    const presented = credential.trim();
    if (!presented) {
      throw new ProviderAuthError('INVALID_PROVIDER_TOKEN', 'Provider credential is required');
    }

    let subject: string;
    try {
      const identity = await this.verifier.verifyCredential(presented);
      subject = identity.subject.trim();
    } catch {
      throw new ProviderAuthError('INVALID_PROVIDER_TOKEN', 'Provider credential is invalid');
    }
    if (!subject) {
      throw new ProviderAuthError('INVALID_PROVIDER_TOKEN', 'Provider identity is invalid');
    }

    const user = await this.identities.findOrCreateUser(this.provider, subject);
    if (user.status !== 'ACTIVE') {
      throw new ProviderAuthError('ACCOUNT_UNAVAILABLE', 'Account is not available for login');
    }

    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.options.sessionTtlSeconds * 1000);
    const refreshExpiresAt = new Date(now.getTime() + this.refreshTtlSeconds * 1000);
    const refreshToken = this.refreshToken();
    if (refreshToken.length < 32) {
      throw new ProviderAuthError('SESSION_ISSUANCE_FAILED', 'Refresh token generator returned weak output');
    }

    const session = await this.sessions.createSession(
      user.id,
      expiresAt,
      hashRefreshToken(refreshToken),
      refreshExpiresAt,
    );

    try {
      const sessionJwt = await this.sessionTokenProvider.issue(
        { userId: user.id, sessionId: session.id, phoneVerified: user.phoneVerified },
        expiresAt,
      );
      return {
        sessionJwt,
        refreshToken,
        userId: user.id,
        isNewUser: user.isNewUser,
        phoneVerified: user.phoneVerified,
        sessionId: session.id,
        expiresAt,
        refreshExpiresAt,
      };
    } catch {
      await this.sessions.revokeSession(user.id, session.id, this.now());
      throw new ProviderAuthError('SESSION_ISSUANCE_FAILED', 'Could not issue API session');
    }
  }
}
