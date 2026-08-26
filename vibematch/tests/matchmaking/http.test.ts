import type { AuthSession } from '../../backend/src/auth/repository';
import type { MatchIntent, MatchIntentDecision } from '../../backend/src/matchmaking/service';
import {
  buildApp,
  type ActiveSessionStore,
  type AuthHttpDependencies,
} from '../../backend/src/http/app';
import type { SessionTokenClaims, SessionTokenVerifier } from '../../backend/src/shared/providers';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const INTENT_ID = '33333333-3333-4333-8333-333333333333';

const matchIntent = (status: MatchIntent['status'] = 'SENT'): MatchIntent => ({
  id: INTENT_ID,
  senderId: USER_A,
  receiverId: USER_B,
  status,
  expiresAt: new Date('2026-08-26T10:10:00.000Z'),
  respondedAt:
    status === 'ACCEPTED' || status === 'DECLINED' ? new Date('2026-08-26T10:01:00.000Z') : null,
  closedAt: null,
  createdAt: new Date('2026-08-26T10:00:00.000Z'),
});

class FakeVerifier implements SessionTokenVerifier {
  constructor(private readonly userId: string) {}

  verify(): Promise<SessionTokenClaims> {
    return Promise.resolve({ userId: this.userId, sessionId: 'session-1', phoneVerified: true });
  }
}

class FakeSessionStore implements ActiveSessionStore {
  findActiveSession(userId: string): Promise<AuthSession> {
    return Promise.resolve({
      id: 'session-1',
      userId,
      expiresAt: new Date('2026-08-27T00:00:00.000Z'),
      revokedAt: null,
    });
  }

  touchSession(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeMatchIntentService {
  createCall: { senderId: string; receiverId: string } | null = null;
  respondCall: {
    receiverId: string;
    intentId: string;
    decision: MatchIntentDecision;
  } | null = null;

  create(senderId: string, receiverId: string): Promise<MatchIntent> {
    this.createCall = { senderId, receiverId };
    return Promise.resolve(matchIntent());
  }

  listIncoming(): Promise<MatchIntent[]> {
    return Promise.resolve([matchIntent()]);
  }

  respond(
    receiverId: string,
    intentId: string,
    decision: MatchIntentDecision,
  ): Promise<MatchIntent> {
    this.respondCall = { receiverId, intentId, decision };
    return Promise.resolve(matchIntent(decision));
  }
}

const createSubject = (userId: string, ageApproved = true) => {
  const matchIntentService = new FakeMatchIntentService();
  const deps: AuthHttpDependencies = {
    authService: {
      loginWithGoogle: () => Promise.reject(new Error('not used')),
      logout: () => Promise.resolve({ ok: true }),
    },
    sessionTokenVerifier: new FakeVerifier(userId),
    activeSessionStore: new FakeSessionStore(),
    ageAssuranceService: {
      getStatus: () => Promise.resolve(ageApproved ? 'APPROVED' : 'PENDING'),
      isApproved: () => Promise.resolve(ageApproved),
    },
    matchIntentService,
  };
  return { app: buildApp(deps), matchIntentService };
};

describe('Match intent HTTP API', () => {
  test('fails closed before matchmaking when age is not approved', async () => {
    const { app, matchIntentService } = createSubject(USER_A, false);
    const response = await app.inject({
      method: 'POST',
      url: '/api/match-intents',
      headers: { authorization: 'Bearer token' },
      payload: { receiver_id: USER_B },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'AGE_ASSURANCE_REQUIRED' });
    expect(matchIntentService.createCall).toBeNull();
    await app.close();
  });

  test('derives the sender from the authenticated session, never the payload', async () => {
    const { app, matchIntentService } = createSubject(USER_A);
    const response = await app.inject({
      method: 'POST',
      url: '/api/match-intents',
      headers: { authorization: 'Bearer token' },
      payload: { receiver_id: USER_B, sender_id: USER_B },
    });

    expect(response.statusCode).toBe(201);
    expect(matchIntentService.createCall).toEqual({ senderId: USER_A, receiverId: USER_B });
    await app.close();
  });

  test('derives the responder from the authenticated session', async () => {
    const { app, matchIntentService } = createSubject(USER_B);
    const response = await app.inject({
      method: 'POST',
      url: `/api/match-intents/${INTENT_ID}/respond`,
      headers: { authorization: 'Bearer token' },
      payload: { decision: 'ACCEPTED', receiver_id: USER_A },
    });

    expect(response.statusCode).toBe(200);
    expect(matchIntentService.respondCall).toEqual({
      receiverId: USER_B,
      intentId: INTENT_ID,
      decision: 'ACCEPTED',
    });
    await app.close();
  });
});
