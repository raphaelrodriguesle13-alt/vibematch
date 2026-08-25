import type { GoogleIdentityProvider, SessionTokenProvider } from '../shared/providers';
import type { AuthSession, AuthUser } from './repository';

export type AuthErrorCode =
  'INVALID_GOOGLE_TOKEN' | 'ACCOUNT_UNAVAILABLE' | 'SESSION_ISSUANCE_FAILED';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthRepositoryPort {
  upsertGoogleUser(googleSubjectId: string): Promise<AuthUser>;
  createSession(userId: string, expiresAt: Date): Promise<AuthSession>;
  revokeSession(userId: string, sessionId: string, revokedAt: Date): Promise<boolean>;
}

export interface GoogleLoginResult {
  sessionJwt: string;
  userId: string;
  isNewUser: boolean;
  phoneVerified: boolean;
  sessionId: string;
  expiresAt: Date;
}

export interface AuthServiceOptions {
  sessionTtlSeconds: number;
  now?: () => Date;
}

export class AuthService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: AuthRepositoryPort,
    private readonly googleIdentityProvider: GoogleIdentityProvider,
    private readonly sessionTokenProvider: SessionTokenProvider,
    private readonly options: AuthServiceOptions,
  ) {
    if (!Number.isInteger(options.sessionTtlSeconds) || options.sessionTtlSeconds <= 0) {
      throw new Error('sessionTtlSeconds must be a positive integer');
    }
    this.now = options.now ?? (() => new Date());
  }

  async loginWithGoogle(googleIdToken: string): Promise<GoogleLoginResult> {
    if (googleIdToken.trim() === '') {
      throw new AuthError('INVALID_GOOGLE_TOKEN', 'Google ID token is required');
    }

    let subject: string;
    try {
      const identity = await this.googleIdentityProvider.verifyIdToken(googleIdToken);
      subject = identity.subject;
    } catch {
      throw new AuthError('INVALID_GOOGLE_TOKEN', 'Google ID token is invalid');
    }

    if (subject.trim() === '') {
      throw new AuthError('INVALID_GOOGLE_TOKEN', 'Google identity subject is invalid');
    }

    const user = await this.repository.upsertGoogleUser(subject);
    if (user.status !== 'ACTIVE') {
      throw new AuthError('ACCOUNT_UNAVAILABLE', 'Account is not available for login');
    }

    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.options.sessionTtlSeconds * 1000);
    const session = await this.repository.createSession(user.id, expiresAt);

    try {
      const sessionJwt = await this.sessionTokenProvider.issue(
        {
          userId: user.id,
          sessionId: session.id,
          phoneVerified: user.phoneVerified,
        },
        expiresAt,
      );
      return {
        sessionJwt,
        userId: user.id,
        isNewUser: user.isNewUser,
        phoneVerified: user.phoneVerified,
        sessionId: session.id,
        expiresAt,
      };
    } catch {
      await this.repository.revokeSession(user.id, session.id, this.now());
      throw new AuthError('SESSION_ISSUANCE_FAILED', 'Could not issue API session');
    }
  }

  async logout(userId: string, sessionId: string): Promise<{ ok: true }> {
    await this.repository.revokeSession(userId, sessionId, this.now());
    return { ok: true };
  }
}
