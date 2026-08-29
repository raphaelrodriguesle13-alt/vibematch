import { createHmac } from 'node:crypto';
import type { SmsVerificationProvider } from '../shared/providers';
import type { PhoneLoginChallenge } from './phone-login-repository';
import { ProviderAuthError, type ProviderLoginResult } from './provider-service';
import type { AuthRateLimiter } from './rate-limit';

export type PhoneLoginErrorCode =
  | 'INVALID_PHONE'
  | 'INVALID_CODE'
  | 'LOGIN_NOT_AVAILABLE'
  | 'TOO_MANY_ATTEMPTS'
  | 'SMS_PROVIDER_UNAVAILABLE'
  | 'ACCOUNT_UNAVAILABLE'
  | 'SESSION_ISSUANCE_FAILED';

export class PhoneLoginError extends Error {
  constructor(
    readonly code: PhoneLoginErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PhoneLoginError';
  }
}

export interface PhoneLoginRepositoryPort {
  createChallenge(params: {
    providerVerificationId: string;
    phoneHash: string;
    expiresAt: Date;
  }): Promise<PhoneLoginChallenge>;
  findPendingChallenge(id: string, now: Date): Promise<PhoneLoginChallenge | null>;
  incrementAttempts(id: string, now: Date): Promise<void>;
  consumeChallenge(id: string, maxAttempts: number, consumedAt: Date): Promise<string | null>;
}

export interface VerifiedPhoneSessionIssuer {
  issueVerifiedIdentity(phoneHash: string): Promise<ProviderLoginResult>;
}

export type PhoneLoginServiceOptions = {
  phoneHashPepper: string;
  maxAttempts?: number;
  now?: () => Date;
  rateLimiter?: AuthRateLimiter;
};

const E164 = /^\+[1-9]\d{7,14}$/;

export class PhoneLoginService {
  private readonly now: () => Date;
  private readonly maxAttempts: number;

  constructor(
    private readonly repository: PhoneLoginRepositoryPort,
    private readonly smsProvider: SmsVerificationProvider,
    private readonly sessionIssuer: VerifiedPhoneSessionIssuer,
    private readonly options: PhoneLoginServiceOptions,
  ) {
    if (!options.phoneHashPepper.trim()) throw new Error('Phone hash pepper is required');
    this.maxAttempts = options.maxAttempts ?? 5;
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts <= 0) {
      throw new Error('maxAttempts must be a positive integer');
    }
    this.now = options.now ?? (() => new Date());
  }

  async start(phoneE164: string): Promise<{ verificationId: string; expiresAt: Date }> {
    const normalized = phoneE164.trim();
    if (!E164.test(normalized)) {
      throw new PhoneLoginError('INVALID_PHONE', 'Phone must use E.164 format');
    }
    await this.enforceRateLimit('PHONE_LOGIN_START', normalized);

    let providerResult: Awaited<ReturnType<SmsVerificationProvider['start']>>;
    try {
      providerResult = await this.smsProvider.start('phone-login', normalized);
    } catch {
      throw new PhoneLoginError('SMS_PROVIDER_UNAVAILABLE', 'SMS provider is unavailable');
    }

    const challenge = await this.repository.createChallenge({
      providerVerificationId: providerResult.providerVerificationId,
      phoneHash: this.hashPhone(normalized),
      expiresAt: providerResult.expiresAt,
    });
    return { verificationId: challenge.id, expiresAt: challenge.expiresAt };
  }

  async confirm(verificationId: string, code: string): Promise<ProviderLoginResult> {
    const challengeId = verificationId.trim();
    const normalizedCode = code.trim();
    if (!challengeId || !normalizedCode) {
      throw new PhoneLoginError('INVALID_CODE', 'Verification id and code are required');
    }

    await this.enforceRateLimit('PHONE_LOGIN_CONFIRM', challengeId);
    const now = this.now();
    const challenge = await this.repository.findPendingChallenge(challengeId, now);
    if (!challenge) {
      throw new PhoneLoginError('LOGIN_NOT_AVAILABLE', 'Phone login challenge is unavailable');
    }
    if (challenge.attempts >= this.maxAttempts) {
      throw new PhoneLoginError('TOO_MANY_ATTEMPTS', 'Phone login challenge is locked');
    }

    let accepted: boolean;
    try {
      accepted = await this.smsProvider.confirm(challenge.providerVerificationId, normalizedCode);
    } catch {
      throw new PhoneLoginError('SMS_PROVIDER_UNAVAILABLE', 'SMS provider is unavailable');
    }

    if (!accepted) {
      await this.repository.incrementAttempts(challengeId, this.now());
      throw new PhoneLoginError('INVALID_CODE', 'Verification code is invalid');
    }

    const phoneHash = await this.repository.consumeChallenge(
      challengeId,
      this.maxAttempts,
      this.now(),
    );
    if (!phoneHash) {
      throw new PhoneLoginError('LOGIN_NOT_AVAILABLE', 'Phone login challenge is unavailable');
    }

    try {
      return await this.sessionIssuer.issueVerifiedIdentity(phoneHash);
    } catch (error) {
      if (error instanceof ProviderAuthError) {
        if (error.code === 'ACCOUNT_UNAVAILABLE') {
          throw new PhoneLoginError('ACCOUNT_UNAVAILABLE', 'Account is not available for login');
        }
        if (error.code === 'SESSION_ISSUANCE_FAILED') {
          throw new PhoneLoginError('SESSION_ISSUANCE_FAILED', 'Could not issue API session');
        }
      }
      throw error;
    }
  }

  private async enforceRateLimit(
    scope: 'PHONE_LOGIN_START' | 'PHONE_LOGIN_CONFIRM',
    keyMaterial: string,
  ): Promise<void> {
    if (!this.options.rateLimiter) return;
    try {
      const decision = await this.options.rateLimiter.consume(scope, keyMaterial, this.now());
      if (!decision.allowed) {
        throw new PhoneLoginError('TOO_MANY_ATTEMPTS', 'Phone login is rate limited');
      }
    } catch (error) {
      if (error instanceof PhoneLoginError) throw error;
      throw new PhoneLoginError(
        'SMS_PROVIDER_UNAVAILABLE',
        'Phone login rate limiter is unavailable',
      );
    }
  }

  private hashPhone(phoneE164: string): string {
    return createHmac('sha256', this.options.phoneHashPepper).update(phoneE164).digest('hex');
  }
}
