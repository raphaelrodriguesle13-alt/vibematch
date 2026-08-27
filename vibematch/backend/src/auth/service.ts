import { createHash, randomBytes } from 'node:crypto';
import type { GoogleIdentityProvider, SessionTokenProvider } from '../shared/providers';
import type { AuthSession, AuthUser, RefreshRotationResult } from './repository';

export type AuthErrorCode =
  | 'INVALID_GOOGLE_TOKEN'
  | 'ACCOUNT_UNAVAILABLE'
  | 'SESSION_ISSUANCE_FAILED'
  | 'INVALID_REFRESH_TOKEN';

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
  createSession(
    userId: string,
    expiresAt: Date,
    refreshTokenHash?: string,
    refreshExpiresAt?: Date,
  ): Promise<AuthSession>;
  rotateRefreshSession?(params: {
    presentedHash: string;
    replacementHash: string;
    accessExpiresAt: Date;
    now: Date;
  }): Promise<RefreshRotationResult | null>;
  revokeSessionByRefreshHash?(refreshHash: string, revokedAt: Date): Promise<void>;
  revokeSession(userId: string, sessionId: string, revokedAt: Date): Promise<boolean>;
}

export interface GoogleLoginResult {
  sessionJwt: string;
  refreshToken?: string;
  userId: string;
  isNewUser: boolean;
  phoneVerified: boolean;
  sessionId: string;
  expiresAt: Date;
  refreshExpiresAt?: Date;
}

export interface RefreshResult {
  sessionJwt: string;
  refreshToken: string;
  userId: string;
  phoneVerified: boolean;
  sessionId: string;
  expiresAt: Date;
  refreshExpiresAt: Date;
}

export interface AuthServiceOptions {
  sessionTtlSeconds: number;
  refreshTtlSeconds?: number;
  now?: () => Date;
  refreshToken?: () => string;
}

const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export class AuthService {
  private readonly now: () => Date;
  private readonly refreshToken: () => string;
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly repository: AuthRepositoryPort,
    private readonly googleIdentityProvider: GoogleIdentityProvider,
    private readonly sessionTokenProvider: SessionTokenProvider,
    private readonly options: AuthServiceOptions,
  ) {
    if (!Number.isInteger(options.sessionTtlSeconds) || options.sessionTtlSeconds <= 0) {
      throw new Error('sessionTtlSeconds must be a positive integer');
    }
    const refreshTtlSeconds = options.refreshTtlSeconds ?? 30 * 24 * 60 * 60;
    if (!Number.isInteger(refreshTtlSeconds) || refreshTtlSeconds <= options.sessionTtlSeconds) {
      throw new Error('refreshTtlSeconds must be an integer greater than sessionTtlSeconds');
    }
    this.refreshTtlSeconds = refreshTtlSeconds;
    this.now = options.now ?? (() => new Date());
    this.refreshToken = options.refreshToken ?? (() => randomBytes(32).toString('base64url'));
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
    const refreshExpiresAt = new Date(now.getTime() + this.refreshTtlSeconds * 1000);
    const refreshToken = this.refreshToken();
    if (refreshToken.length < 32) {
      throw new AuthError(
        'SESSION_ISSUANCE_FAILED',
        'Refresh token generator returned weak output',
      );
    }
    const session = await this.repository.createSession(
      user.id,
      expiresAt,
      hashRefreshToken(refreshToken),
      refreshExpiresAt,
    );

    try {
      const sessionJwt = await this.issueSessionJwt(
        user.id,
        session.id,
        user.phoneVerified,
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
      await this.repository.revokeSession(user.id, session.id, this.now());
      throw new AuthError('SESSION_ISSUANCE_FAILED', 'Could not issue API session');
    }
  }

  async refresh(presentedToken: string): Promise<RefreshResult> {
    if (presentedToken.trim() === '' || !this.repository.rotateRefreshSession) {
      throw new AuthError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
    }

    const replacementToken = this.refreshToken();
    if (replacementToken.length < 32) {
      throw new AuthError(
        'SESSION_ISSUANCE_FAILED',
        'Refresh token generator returned weak output',
      );
    }
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.options.sessionTtlSeconds * 1000);
    const rotation = await this.repository.rotateRefreshSession({
      presentedHash: hashRefreshToken(presentedToken),
      replacementHash: hashRefreshToken(replacementToken),
      accessExpiresAt: expiresAt,
      now,
    });

    if (!rotation || rotation.reused) {
      throw new AuthError('INVALID_REFRESH_TOKEN', 'Refresh token is invalid or has been reused');
    }

    try {
      const sessionJwt = await this.issueSessionJwt(
        rotation.session.userId,
        rotation.session.id,
        rotation.phoneVerified,
        rotation.session.expiresAt,
      );
      return {
        sessionJwt,
        refreshToken: replacementToken,
        userId: rotation.session.userId,
        phoneVerified: rotation.phoneVerified,
        sessionId: rotation.session.id,
        expiresAt: rotation.session.expiresAt,
        refreshExpiresAt: rotation.refreshExpiresAt,
      };
    } catch {
      await this.repository.revokeSession(rotation.session.userId, rotation.session.id, this.now());
      throw new AuthError('SESSION_ISSUANCE_FAILED', 'Could not rotate API session');
    }
  }

  async logoutWithRefresh(presentedToken: string): Promise<{ ok: true }> {
    if (presentedToken.trim() !== '' && this.repository.revokeSessionByRefreshHash) {
      await this.repository.revokeSessionByRefreshHash(
        hashRefreshToken(presentedToken),
        this.now(),
      );
    }
    return { ok: true };
  }

  async logout(userId: string, sessionId: string): Promise<{ ok: true }> {
    await this.repository.revokeSession(userId, sessionId, this.now());
    return { ok: true };
  }

  private issueSessionJwt(
    userId: string,
    sessionId: string,
    phoneVerified: boolean,
    expiresAt: Date,
  ): Promise<string> {
    return this.sessionTokenProvider.issue({ userId, sessionId, phoneVerified }, expiresAt);
  }
}