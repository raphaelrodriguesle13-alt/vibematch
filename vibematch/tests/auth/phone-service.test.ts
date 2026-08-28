import { jest } from '@jest/globals';
import {
  PhoneVerificationError,
  PhoneVerificationService,
  type PhoneVerificationRepositoryPort,
} from '../../backend/src/auth/phone-service';
import type { AuthRateLimiter } from '../../backend/src/auth/rate-limit';
import type { PhoneVerification } from '../../backend/src/auth/repository';

const userId = '11111111-1111-4111-8111-111111111111';
const verificationId = '22222222-2222-4222-8222-222222222222';
const expiresAt = new Date('2026-08-28T00:30:00.000Z');

class FakePhoneRepository implements PhoneVerificationRepositoryPort {
  active = true;
  createResult: PhoneVerification | null = {
    id: verificationId,
    userId,
    providerVerificationId: 'provider-verification',
    phoneHash: 'hashed-phone',
    expiresAt,
    consumedAt: null,
    attempts: 0,
  };
  pending: PhoneVerification | null = this.createResult;
  consumeResult = true;

  isUserActive(): Promise<boolean> {
    return Promise.resolve(this.active);
  }

  createPhoneVerification(): Promise<PhoneVerification | null> {
    return Promise.resolve(this.createResult);
  }

  findPendingPhoneVerification(): Promise<PhoneVerification | null> {
    return Promise.resolve(this.pending);
  }

  incrementPhoneVerificationAttempts(): Promise<void> {
    return Promise.resolve();
  }

  consumePhoneVerificationAndMarkUserVerified(): Promise<boolean> {
    return Promise.resolve(this.consumeResult);
  }
}

const buildService = (repository: FakePhoneRepository, rateLimiter?: AuthRateLimiter) => {
  const smsProvider = {
    start: jest.fn(() =>
      Promise.resolve({ providerVerificationId: 'provider-verification', expiresAt }),
    ),
    confirm: jest.fn(() => Promise.resolve(true)),
  };
  const service = new PhoneVerificationService(repository, smsProvider, {
    phoneHashPepper: 'test-pepper-that-is-not-a-secret',
    now: () => new Date('2026-08-27T23:30:00.000Z'),
    ...(rateLimiter ? { rateLimiter } : {}),
  });
  return { service, smsProvider };
};

describe('PhoneVerificationService active-account boundary', () => {
  it('does not call the SMS provider when start is requested for a restricted account', async () => {
    const repository = new FakePhoneRepository();
    repository.active = false;
    const { service, smsProvider } = buildService(repository);

    await expect(service.start(userId, '+5511999999999')).rejects.toMatchObject({
      code: 'VERIFICATION_NOT_AVAILABLE',
    } satisfies Partial<PhoneVerificationError>);
    expect(smsProvider.start).not.toHaveBeenCalled();
  });

  it('fails closed if the account becomes restricted after the provider starts', async () => {
    const repository = new FakePhoneRepository();
    repository.createResult = null;
    const { service, smsProvider } = buildService(repository);

    await expect(service.start(userId, '+5511999999999')).rejects.toMatchObject({
      code: 'VERIFICATION_NOT_AVAILABLE',
    } satisfies Partial<PhoneVerificationError>);
    expect(smsProvider.start).toHaveBeenCalledTimes(1);
  });

  it('does not call provider confirm when the account is already restricted', async () => {
    const repository = new FakePhoneRepository();
    repository.active = false;
    const { service, smsProvider } = buildService(repository);

    await expect(service.confirm(userId, verificationId, '123456')).rejects.toMatchObject({
      code: 'VERIFICATION_NOT_AVAILABLE',
    } satisfies Partial<PhoneVerificationError>);
    expect(smsProvider.confirm).not.toHaveBeenCalled();
  });

  it('fails closed if suspension wins after provider acceptance but before persistence', async () => {
    const repository = new FakePhoneRepository();
    repository.consumeResult = false;
    const { service, smsProvider } = buildService(repository);

    await expect(service.confirm(userId, verificationId, '123456')).rejects.toMatchObject({
      code: 'VERIFICATION_NOT_AVAILABLE',
    } satisfies Partial<PhoneVerificationError>);
    expect(smsProvider.confirm).toHaveBeenCalledTimes(1);
  });
});

describe('PhoneVerificationService distributed provider rate limits', () => {
  it('blocks SMS start before calling Twilio when the per-user limit is exceeded', async () => {
    const repository = new FakePhoneRepository();
    const consume = jest.fn(() => Promise.resolve({ allowed: false, retryAfterSeconds: 30 }));
    const { service, smsProvider } = buildService(repository, { consume });

    await expect(service.start(userId, '+5511999999999')).rejects.toMatchObject({
      code: 'TOO_MANY_ATTEMPTS',
    } satisfies Partial<PhoneVerificationError>);
    expect(consume).toHaveBeenCalledWith('PHONE_START', userId, new Date('2026-08-27T23:30:00.000Z'));
    expect(smsProvider.start).not.toHaveBeenCalled();
  });

  it('blocks provider confirm before code verification when the limit is exceeded', async () => {
    const repository = new FakePhoneRepository();
    const consume = jest.fn(() => Promise.resolve({ allowed: false, retryAfterSeconds: 30 }));
    const { service, smsProvider } = buildService(repository, { consume });

    await expect(service.confirm(userId, verificationId, '123456')).rejects.toMatchObject({
      code: 'TOO_MANY_ATTEMPTS',
    } satisfies Partial<PhoneVerificationError>);
    expect(consume).toHaveBeenCalledWith(
      'PHONE_CONFIRM',
      userId,
      new Date('2026-08-27T23:30:00.000Z'),
    );
    expect(smsProvider.confirm).not.toHaveBeenCalled();
  });

  it('fails closed before provider use when the distributed limiter is unavailable', async () => {
    const repository = new FakePhoneRepository();
    const consume = jest.fn(() => Promise.reject(new Error('database unavailable')));
    const { service, smsProvider } = buildService(repository, { consume });

    await expect(service.start(userId, '+5511999999999')).rejects.toMatchObject({
      code: 'SMS_PROVIDER_UNAVAILABLE',
    } satisfies Partial<PhoneVerificationError>);
    expect(smsProvider.start).not.toHaveBeenCalled();
  });
});
