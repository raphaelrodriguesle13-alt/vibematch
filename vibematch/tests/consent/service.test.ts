import {
  ConsentService,
  type Consent,
  type ConsentDecision,
  type ConsentRepositoryPort,
} from '../../backend/src/consent/service';

const USER_A = '11111111-1111-4111-8111-111111111111';
const INTENT_ID = '22222222-2222-4222-8222-222222222222';
const CONSENT_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-08-26T11:00:00.000Z');

const consent = (overrides: Partial<Consent> = {}): Consent => ({
  id: CONSENT_ID,
  matchIntentId: INTENT_ID,
  userAId: USER_A,
  userBId: '55555555-5555-4555-8555-555555555555',
  userAStatus: 'PENDING',
  userBStatus: 'PENDING',
  status: 'PENDING',
  expiresAt: new Date('2026-08-26T11:10:00.000Z'),
  videoDeadline: null,
  acceptedBothAt: null,
  ...overrides,
});

class FakeConsentRepository implements ConsentRepositoryPort {
  createResult: Consent | null = consent();
  decisionResult: Consent | null = consent({ userAStatus: 'ACCEPTED' });
  rateLimitAllowed = true;
  rateLimitCall: { userId: string; now: Date; limit: number } | null = null;
  created: { userId: string; matchIntentId: string; expiresAt: Date } | null = null;
  decided: {
    actingUserId: string;
    consentId: string;
    decision: ConsentDecision;
    authSessionRef: string;
    requestId: string;
    now: Date;
    videoDeadline: Date;
  } | null = null;

  createEligible(userId: string, matchIntentId: string, expiresAt: Date): Promise<Consent | null> {
    this.created = { userId, matchIntentId, expiresAt };
    return Promise.resolve(this.createResult);
  }

  consumeDecisionRateLimit(userId: string, now: Date, limit: number): Promise<boolean> {
    this.rateLimitCall = { userId, now, limit };
    return Promise.resolve(this.rateLimitAllowed);
  }

  decide(
    actingUserId: string,
    consentId: string,
    decision: ConsentDecision,
    authSessionRef: string,
    requestId: string,
    now: Date,
    videoDeadline: Date,
  ): Promise<Consent | null> {
    this.decided = {
      actingUserId,
      consentId,
      decision,
      authSessionRef,
      requestId,
      now,
      videoDeadline,
    };
    return Promise.resolve(this.decisionResult);
  }
}

describe('ConsentService', () => {
  test('uses server-controlled consent expiry', async () => {
    const repository = new FakeConsentRepository();
    const service = new ConsentService(repository, () => NOW, 10 * 60 * 1000);

    await service.create(USER_A, INTENT_ID);

    expect(repository.created).toEqual({
      userId: USER_A,
      matchIntentId: INTENT_ID,
      expiresAt: new Date('2026-08-26T11:10:00.000Z'),
    });
  });

  test('rate limits consent decisions before touching consent state', async () => {
    const repository = new FakeConsentRepository();
    repository.rateLimitAllowed = false;
    const service = new ConsentService(repository, () => NOW, 10 * 60 * 1000, 5 * 60 * 1000, 30);

    await expect(
      service.decide(USER_A, CONSENT_ID, 'ACCEPTED', 'session-1', REQUEST_ID),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(repository.rateLimitCall).toEqual({ userId: USER_A, now: NOW, limit: 30 });
    expect(repository.decided).toBeNull();
  });

  test('uses authenticated session metadata and a server-controlled video window', async () => {
    const repository = new FakeConsentRepository();
    const service = new ConsentService(repository, () => NOW, 10 * 60 * 1000, 5 * 60 * 1000);

    await service.decide(USER_A, CONSENT_ID, 'ACCEPTED', 'session-1', REQUEST_ID);

    expect(repository.decided).toEqual({
      actingUserId: USER_A,
      consentId: CONSENT_ID,
      decision: 'ACCEPTED',
      authSessionRef: 'session-1',
      requestId: REQUEST_ID,
      now: NOW,
      videoDeadline: new Date('2026-08-26T11:05:00.000Z'),
    });
  });

  test('rejects malformed ids before persistence', async () => {
    const repository = new FakeConsentRepository();
    const service = new ConsentService(repository, () => NOW);

    await expect(service.create(USER_A, 'invalid')).rejects.toMatchObject({
      code: 'INVALID_CONSENT',
    });
    await expect(
      service.decide(USER_A, CONSENT_ID, 'ACCEPTED', 'session-1', 'invalid'),
    ).rejects.toMatchObject({ code: 'INVALID_CONSENT' });
    expect(repository.created).toBeNull();
    expect(repository.rateLimitCall).toBeNull();
    expect(repository.decided).toBeNull();
  });

  test('returns a non-disclosing error when consent is no longer available', async () => {
    const repository = new FakeConsentRepository();
    repository.decisionResult = null;
    const service = new ConsentService(repository, () => NOW);

    await expect(
      service.decide(USER_A, CONSENT_ID, 'DECLINED', 'session-1', REQUEST_ID),
    ).rejects.toMatchObject({ code: 'CONSENT_NOT_AVAILABLE' });
  });
});
