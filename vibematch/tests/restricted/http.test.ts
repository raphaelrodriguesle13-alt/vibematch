import type { AuthSession } from '../../backend/src/auth/repository';
import type { Consent, ConsentDecision } from '../../backend/src/consent/service';
import {
  buildApp,
  type ActiveSessionStore,
  type AuthHttpDependencies,
} from '../../backend/src/http/app';
import type { Block, Report } from '../../backend/src/moderation/service';
import type { SessionTokenClaims, SessionTokenVerifier } from '../../backend/src/shared/providers';
import type { VideoSession } from '../../backend/src/video/service';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const INTENT_ID = '33333333-3333-4333-8333-333333333333';
const CONSENT_ID = '44444444-4444-4444-8444-444444444444';
const VIDEO_SESSION_ID = '55555555-5555-4555-8555-555555555555';
const REQUEST_ID = '66666666-6666-4666-8666-666666666666';
const AUTH_SESSION_ID = '77777777-7777-4777-8777-777777777777';

const consent: Consent = {
  id: CONSENT_ID,
  matchIntentId: INTENT_ID,
  userAId: USER_A,
  userBId: USER_B,
  userAStatus: 'PENDING',
  userBStatus: 'PENDING',
  status: 'PENDING',
  expiresAt: new Date('2026-08-26T17:00:00.000Z'),
  videoDeadline: null,
  acceptedBothAt: null,
};

const videoSession: VideoSession = {
  id: VIDEO_SESSION_ID,
  consentId: CONSENT_ID,
  livekitRoom: 'server-only-room',
  status: 'CREATED',
  revocationPending: false,
  revokedAt: null,
};

class FakeVerifier implements SessionTokenVerifier {
  verify(): Promise<SessionTokenClaims> {
    return Promise.resolve({
      userId: USER_A,
      sessionId: AUTH_SESSION_ID,
      phoneVerified: false,
    });
  }
}

class FakeSessionStore implements ActiveSessionStore {
  findActiveSession(): Promise<AuthSession> {
    return Promise.resolve({
      id: AUTH_SESSION_ID,
      userId: USER_A,
      expiresAt: new Date('2026-08-27T00:00:00.000Z'),
      revokedAt: null,
    });
  }

  touchSession(): Promise<void> {
    return Promise.resolve();
  }
}

const baseDeps = (): AuthHttpDependencies => ({
  authService: {
    loginWithGoogle: () => Promise.reject(new Error('not used')),
    logout: () => Promise.resolve({ ok: true }),
  },
  sessionTokenVerifier: new FakeVerifier(),
  activeSessionStore: new FakeSessionStore(),
  phoneStateStore: { isPhoneVerified: () => Promise.resolve(true) },
  ageAssuranceService: {
    getStatus: () => Promise.resolve('APPROVED'),
    isApproved: () => Promise.resolve(true),
  },
});

describe('Restricted HTTP safety boundaries', () => {
  test('consent decision derives actor and auth session from authentication, not payload', async () => {
    let call: {
      actingUserId: string;
      consentId: string;
      decision: ConsentDecision;
      authSessionRef: string;
      requestId: string;
    } | null = null;
    const deps = baseDeps();
    deps.consentService = {
      create: () => Promise.resolve(consent),
      decide: (actingUserId, consentId, decision, authSessionRef, requestId) => {
        call = { actingUserId, consentId, decision, authSessionRef, requestId };
        return Promise.resolve(consent);
      },
    };
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: `/api/consents/${CONSENT_ID}/decision`,
      headers: { authorization: 'Bearer token' },
      payload: {
        decision: 'ACCEPTED',
        request_id: REQUEST_ID,
        acting_user_id: USER_B,
        auth_session_ref: 'attacker-controlled-session',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(call).toEqual({
      actingUserId: USER_A,
      consentId: CONSENT_ID,
      decision: 'ACCEPTED',
      authSessionRef: AUTH_SESSION_ID,
      requestId: REQUEST_ID,
    });
    await app.close();
  });

  test('video token request derives participant identity from authentication', async () => {
    let tokenCall: { userId: string; sessionId: string } | null = null;
    const deps = baseDeps();
    deps.videoSessionService = {
      create: () => Promise.resolve(videoSession),
      issueToken: (userId, sessionId) => {
        tokenCall = { userId, sessionId };
        return Promise.resolve('signed-by-server');
      },
    };
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: `/api/video/sessions/${VIDEO_SESSION_ID}/token`,
      headers: { authorization: 'Bearer token' },
      payload: { user_id: USER_B, room_name: 'client-room' },
    });

    expect(response.statusCode).toBe(200);
    expect(tokenCall).toEqual({ userId: USER_A, sessionId: VIDEO_SESSION_ID });
    expect(response.json()).toEqual({
      data: { session_id: VIDEO_SESSION_ID, token: 'signed-by-server' },
    });
    await app.close();
  });

  test('block remains available even when phone and age gates are not satisfied', async () => {
    let blockedId: string | null = null;
    const deps = baseDeps();
    deps.phoneStateStore = { isPhoneVerified: () => Promise.resolve(false) };
    deps.ageAssuranceService = {
      getStatus: () => Promise.resolve('REJECTED'),
      isApproved: () => Promise.resolve(false),
    };
    deps.moderationService = {
      block: (blockerId, targetId) => {
        blockedId = targetId;
        const block: Block = {
          id: '88888888-8888-4888-8888-888888888888',
          blockerId,
          blockedId: targetId,
          createdAt: new Date('2026-08-26T16:00:00.000Z'),
        };
        return Promise.resolve(block);
      },
      report: () => Promise.reject(new Error('not used')),
    };
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/blocks',
      headers: { authorization: 'Bearer token' },
      payload: { blocked_id: USER_B },
    });

    expect(response.statusCode).toBe(201);
    expect(blockedId).toBe(USER_B);
    await app.close();
  });

  test('report endpoint never forwards client-controlled severity', async () => {
    let input: { reportedId: string; sessionId?: string | null; category: string } | null = null;
    const deps = baseDeps();
    deps.moderationService = {
      block: () => Promise.reject(new Error('not used')),
      report: (reporterId, reportInput) => {
        input = reportInput;
        const report: Report = {
          id: '99999999-9999-4999-8999-999999999999',
          reporterId,
          reportedId: reportInput.reportedId,
          sessionId: reportInput.sessionId ?? null,
          category: 'OTHER',
          severity: 'LOW',
          status: 'OPEN',
          createdAt: new Date('2026-08-26T16:00:00.000Z'),
        };
        return Promise.resolve(report);
      },
    };
    const app = buildApp(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: { authorization: 'Bearer token' },
      payload: {
        reported_id: USER_B,
        category: 'OTHER',
        severity: 'CRITICAL',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(input).toEqual({ reportedId: USER_B, sessionId: null, category: 'OTHER' });
    await app.close();
  });
});
