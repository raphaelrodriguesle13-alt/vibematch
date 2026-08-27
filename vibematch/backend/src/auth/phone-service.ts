import { createHmac } from 'node:crypto';
import type { SmsVerificationProvider } from '../shared/providers';
import type { PhoneVerification } from './repository';

export type PhoneVerificationErrorCode =
  | 'INVALID_PHONE'
  | 'INVALID_CODE'
  | 'VERIFICATION_NOT_AVAILABLE'
  | 'TOO_MANY_ATTEMPTS'
  | 'SMS_PROVIDER_UNAVAILABLE';

export class PhoneVerificationError extends Error {
  constructor(
    readonly code: PhoneVerificationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PhoneVerificationError';
  }
}

export interface PhoneVerificationRepositoryPort {
  isUserActive(userId: string): Promise<boolean>;
  createPhoneVerification(params: {
    userId: string;
    providerVerificationId: string;
    phoneHash: string;
    expiresAt: Date;
  }): Promise<PhoneVerification | null>;
  findPendingPhoneVerification(
    userId: string,
    verificationId: string,
    now: Date,
  ): Promise<PhoneVerification | null>;
  incrementPhoneVerificationAttempts(userId: string, verificationId: string): Promise<void>;
  consumePhoneVerificationAndMarkUserVerified(
    userId: string,
    verificationId: string,
    consumedAt: Date,
  ): Promise<boolean>;
}

export interface PhoneVerificationServiceOptions {
  phoneHashPepper: string;
  maxAttempts?: number;
  now?: () => Date;
}

const E164 = /^\+[1-9]\d{7,14}$/;

export class PhoneVerificationService {
  private readonly now: () => Date;
  private readonly maxAttempts: number;

  constructor(
    private readonly repository: PhoneVerificationRepositoryPort,
    private readonly smsProvider: SmsVerificationProvider,
    private readonly options: PhoneVerificationServiceOptions,
  ) {
    if (options.phoneHashPepper.trim() === '') throw new Error('Phone hash pepper is required');
    this.maxAttempts = options.maxAttempts ?? 5;
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts <= 0) {
      throw new Error('maxAttempts must be a positive integer');
    }
    this.now = options.now ?? (() => new Date());
  }

  async start(
    userId: string,
    phoneE164: string,
  ): Promise<{ verificationId: string; expiresAt: Date }> {
    const normalized = phoneE164.trim();
    if (!E164.test(normalized)) {
      throw new PhoneVerificationError('INVALID_PHONE', 'Phone must use E.164 format');
    }
    if (!(await this.repository.isUserActive(userId))) {
      throw new PhoneVerificationError('VERIFICATION_NOT_AVAILABLE', 'Phone verification unavailable');
    }

    let providerResult: Awaited<ReturnType<SmsVerificationProvider['start']>>;
    try {
      providerResult = await this.smsProvider.start(userId, normalized);
    } catch {
      throw new PhoneVerificationError('SMS_PROVIDER_UNAVAILABLE', 'SMS provider is unavailable');
    }

    const verification = await this.repository.createPhoneVerification({
      userId,
      providerVerificationId: providerResult.providerVerificationId,
      phoneHash: this.hashPhone(normalized),
      expiresAt: providerResult.expiresAt,
    });
    if (!verification) {
      throw new PhoneVerificationError('VERIFICATION_NOT_AVAILABLE', 'Phone verification unavailable');
    }

    return { verificationId: verification.id, expiresAt: verification.expiresAt };
  }

  async confirm(
    userId: string,
    verificationId: string,
    code: string,
  ): Promise<{ ok: true; phoneVerified: true }> {
    if (verificationId.trim() === '' || code.trim() === '') {
      throw new PhoneVerificationError('INVALID_CODE', 'Verification id and code are required');
    }
    if (!(await this.repository.isUserActive(userId))) {
      throw new PhoneVerificationError('VERIFICATION_NOT_AVAILABLE', 'Phone verification unavailable');
    }

    const verification = await this.repository.findPendingPhoneVerification(
      userId,
      verificationId,
      this.now(),
    );
    if (!verification) {
      throw new PhoneVerificationError(
        'VERIFICATION_NOT_AVAILABLE',
        'Phone verification is expired, consumed, or unavailable',
      );
    }
    if (verification.attempts >= this.maxAttempts) {
      throw new PhoneVerificationError('TOO_MANY_ATTEMPTS', 'Phone verification is locked');
    }

    let accepted: boolean;
    try {
      accepted = await this.smsProvider.confirm(verification.providerVerificationId, code.trim());
    } catch {
      throw new PhoneVerificationError('SMS_PROVIDER_UNAVAILABLE', 'SMS provider is unavailable');
    }

    if (!accepted) {
      await this.repository.incrementPhoneVerificationAttempts(userId, verificationId);
      throw new PhoneVerificationError('INVALID_CODE', 'Verification code is invalid');
    }

    const consumed = await this.repository.consumePhoneVerificationAndMarkUserVerified(
      userId,
      verificationId,
      this.now(),
    );
    if (!consumed) {
      throw new PhoneVerificationError(
        'VERIFICATION_NOT_AVAILABLE',
        'Phone verification is expired, consumed, or unavailable',
      );
    }

    return { ok: true, phoneVerified: true };
  }

  private hashPhone(phoneE164: string): string {
    return createHmac('sha256', this.options.phoneHashPepper).update(phoneE164).digest('hex');
  }
}
