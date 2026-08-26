import {
  MatchIntentService,
  type MatchIntent,
  type MatchIntentDecision,
  type MatchIntentRepositoryPort,
} from '../../backend/src/matchmaking/service';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const INTENT_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-08-26T10:00:00.000Z');

const intent = (overrides: Partial<MatchIntent> = {}): MatchIntent => ({
  id: INTENT_ID,
  senderId: USER_A,
  receiverId: USER_B,
  status: 'SENT',
  expiresAt: new Date('2026-08-26T10:10:00.000Z'),
  respondedAt: null,
  closedAt: null,
  createdAt: NOW,
  ...overrides,
});

class FakeMatchIntentRepository implements MatchIntentRepositoryPort {
  created: { senderId: string; receiverId: string; expiresAt: Date } | null = null;
  createResult: MatchIntent | null = intent();
  respondResult: MatchIntent | null = intent({ status: 'ACCEPTED', respondedAt: NOW });
  response: { receiverId: string; intentId: string; decision: MatchIntentDecision; now: Date } | null = null;

  createEligible(senderId: string, receiverId: string, expiresAt: Date): Promise<MatchIntent | null> {
    this.created = { senderId, receiverId, expiresAt };
    return Promise.resolve(this.createResult);
  }

  listIncoming(): Promise<MatchIntent[]> {
    return Promise.resolve([intent()]);
  }

  respond(
    receiverId: string,
    intentId: string,
    decision: MatchIntentDecision,
    now: Date,
  ): Promise<MatchIntent | null> {
    this.response = { receiverId, intentId, decision, now };
    return Promise.resolve(this.respondResult);
  }
}

describe('MatchIntentService', () => {
  test('creates intents with a bounded server-side expiry', async () => {
    const repository = new FakeMatchIntentRepository();
    const service = new MatchIntentService(repository, () => NOW, 5 * 60 * 1000);

    await service.create(USER_A, USER_B);

    expect(repository.created).toEqual({
      senderId: USER_A,
      receiverId: USER_B,
      expiresAt: new Date('2026-08-26T10:05:00.000Z'),
    });
  });

  test('rejects self targeting and malformed targets before persistence', async () => {
    const repository = new FakeMatchIntentRepository();
    const service = new MatchIntentService(repository, () => NOW);

    await expect(service.create(USER_A, USER_A)).rejects.toMatchObject({
      code: 'INVALID_TARGET',
    });
    await expect(service.create(USER_A, 'not-a-uuid')).rejects.toMatchObject({
      code: 'INVALID_TARGET',
    });
    expect(repository.created).toBeNull();
  });

  test('does not disclose why an eligible insert was refused', async () => {
    const repository = new FakeMatchIntentRepository();
    repository.createResult = null;
    const service = new MatchIntentService(repository, () => NOW);

    await expect(service.create(USER_A, USER_B)).rejects.toMatchObject({
      code: 'NOT_ELIGIBLE',
    });
  });

  test('responds using server time and receiver identity', async () => {
    const repository = new FakeMatchIntentRepository();
    const service = new MatchIntentService(repository, () => NOW);

    await service.respond(USER_B, INTENT_ID, 'ACCEPTED');

    expect(repository.response).toEqual({
      receiverId: USER_B,
      intentId: INTENT_ID,
      decision: 'ACCEPTED',
      now: NOW,
    });
  });
});
