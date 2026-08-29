import { jest } from '@jest/globals';
import type { PhoneLoginChallenge } from '../../backend/src/auth/phone-login-repository';
import {
  PhoneLoginError,
  PhoneLoginService,
  type PhoneLoginRepositoryPort,
  type VerifiedPhoneSessionIssuer,
} from '../../backend/src/auth/phone-login-service';
import type { ProviderLoginResult } from '../../backend/src/auth/provider-service';
import type { AuthRateLimiter } from '../../backend/src/auth/rate-limit';

const verificationId = '11111111-1111-4111-8111-111111111111';
const expiresAt = new Date('2026-08-29T14:00:00.000Z');
const now = new Date('2026-08-29T13:00:00.000Z');

const loginResult: ProviderLoginResult = {
  sessionJwt: 'jwt',
  refreshToken: 'r'.repeat(43),
  userId: '22222222-2222-4222-8222-222222222222',
  isNewUser: true,
  phoneVerified: true,
  sessionId: '33333333-3333-4333-8333-333333333333',
  expiresAt: new Date('2026-08-29T13:15:00.000Z'),
  refreshExpiresAt: new Date('2026-09-28T13:00:00.000Z'),
};

class FakePhoneLoginRepository implements PhoneLoginRepositoryPort {
  challenge: PhoneLoginChallenge | null = {
    id: verificationId,
    providerVerificationId: 'provider-verification',
    phoneHash: 'server-side-phone-hash',
    expiresAt,
    consumedAt: null,
    attempts: 0,
  };
  consumeResult: string | null = 'server-side-phone-hash';
  createChallenge = jest.fn((params: Parameters<PhoneLoginRepositoryPort['createChallenge']>[0]) =>
    Promise.resolve({
      id: verificationId,
      providerVerificationId: params.providerVerificationId,
      phoneHash: params.phoneHash,
      expiresAt: params.expiresAt,
      consumedAt: null,
      attempts: 0,
    }),
  );
  findPendingChallenge = jest.fn(() => Promise.resolve(this.challenge));
  incrementAttempts = jest.fn(() => Promise.resolve());
  consumeChallenge = jest.fn(() => Promise.resolve(this.consumeResult));
}

const buildService = (params?: {
  repository?: FakePhoneLoginRepository;
  accepted?: boolean;
  rateLimiter?: AuthRateLimiter;
}) => {
  const repository = params?.repository ?? new FakePhoneLoginRepository();
  const smsProvider = {
    start: jest.fn(() =>
      Promise.resolve({ providerVerificationId: 'provider-verification', expiresAt }),
    ),
    confirm: jest.fn(() => Promise.resolve(params?.accepted ?? true)),
  };
  const issueVerifiedIdentity = jest.fn(() => Promise.resolve(loginResult));
  const sessionIssuer: VerifiedPhoneSessionIssuer = { issueVerifiedIdentity };
  const service = new PhoneLoginService(repository, smsProvider, sessionIssuer, {
    phoneHashPepper: 'test-pepper-that-is-not-a-production-secret',
    now: () => now,
    ...(params?.rateLimiter ? { rateLimiter: params.rateLimiter } : {}),
  });
  return { service, repository, smsProvider, issueVerifiedIdentity };
};

describe('PhoneLoginService', () => {
  it('rejects malformed numbers before calling the SMS provider', async () => {
    const { service, smsProvider } = buildService();

    await expect(service.start('11999999999')).rejects.toMatchObject({
      code: 'INVALID_PHONE',
    } satisfies Partial<PhoneLoginError>);
    expect(smsProvider.start).not.toHaveBeenCalled();
  });

  it('stores only a server-side phone hash in the challenge', async () => {
    const { service, repository, smsProvider } = buildService();
    const phone = '+5511999999999';

    await service.start(phone);

    expect(smsProvider.start).toHaveBeenCalledWith('phone-login', phone);
    const challengeParams = repository.createChallenge.mock.calls[0]?.[0];
    expect(challengeParams?.phoneHash).toHaveLength(64);
    expect(challengeParams?.phoneHash).not.toBe(phone);
  });

  it('rate limits SMS start before provider use', async () => {
    const consume = jest.fn(() => Promise.resolve({ allowed: false, retryAfterSeconds: 30 }));
    const { service, smsProvider } = buildService({ rateLimiter: { consume } });

    await expect(service.start('+5511999999999')).rejects.toMatchObject({
      code: 'TOO_MANY_ATTEMPTS',
    } satisfies Partial<PhoneLoginError>);
    expect(consume).toHaveBeenCalledWith('PHONE_LOGIN_START', '+5511999999999', now);
    expect(smsProvider.start).not.toHaveBeenCalled();
  });

  it('increments attempts and never issues a session for an invalid OTP', async () => {
    const { service, repository, issueVerifiedIdentity } = buildService({ accepted: false });

    await expect(service.confirm(verificationId, '000000')).rejects.toMatchObject({
      code: 'INVALID_CODE',
    } satisfies Partial<PhoneLoginError>);
    expect(repository.incrementAttempts.mock.calls).toContainEqual([verificationId, now]);
    expect(issueVerifiedIdentity).not.toHaveBeenCalled();
  });

  it('atomically consumes a valid challenge before issuing a phone session', async () => {
    const { service, repository, issueVerifiedIdentity } = buildService();

    const result = await service.confirm(verificationId, '123456');

    expect(repository.consumeChallenge.mock.calls).toContainEqual([verificationId, 5, now]);
    expect(issueVerifiedIdentity).toHaveBeenCalledWith('server-side-phone-hash');
    expect(result.phoneVerified).toBe(true);
  });

  it('does not issue a session when another confirmation already consumed the challenge', async () => {
    const repository = new FakePhoneLoginRepository();
    repository.consumeResult = null;
    const { service, issueVerifiedIdentity } = buildService({ repository });

    await expect(service.confirm(verificationId, '123456')).rejects.toMatchObject({
      code: 'LOGIN_NOT_AVAILABLE',
    } satisfies Partial<PhoneLoginError>);
    expect(issueVerifiedIdentity).not.toHaveBeenCalled();
  });

  it('locks a challenge after the configured attempt ceiling', async () => {
    const repository = new FakePhoneLoginRepository();
    if (repository.challenge) repository.challenge.attempts = 5;
    const { service, smsProvider } = buildService({ repository });

    await expect(service.confirm(verificationId, '123456')).rejects.toMatchObject({
      code: 'TOO_MANY_ATTEMPTS',
    } satisfies Partial<PhoneLoginError>);
    expect(smsProvider.confirm).not.toHaveBeenCalled();
  });
});
