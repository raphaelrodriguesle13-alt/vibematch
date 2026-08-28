import { randomUUID } from 'node:crypto';
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import { JwtSessionProvider } from '../../../backend/src/auth/providers/jwt';
import { AuthRepository } from '../../../backend/src/auth/repository';
import { AuthService } from '../../../backend/src/auth/service';
import { ConsentRepository } from '../../../backend/src/consent/repository';
import { ConsentService } from '../../../backend/src/consent/service';
import { buildApp } from '../../../backend/src/http/app';
import { MatchIntentRepository } from '../../../backend/src/matchmaking/repository';
import { MatchIntentService } from '../../../backend/src/matchmaking/service';
import { ModerationRepository } from '../../../backend/src/moderation/repository';
import { ModerationService } from '../../../backend/src/moderation/service';
import { AgeAssuranceRepository } from '../../../backend/src/profile/age-assurance-repository';
import { AgeAssuranceService } from '../../../backend/src/profile/age-assurance';
import type { GoogleIdentityProvider } from '../../../backend/src/shared/providers';
import { LiveKitTokenProvider } from '../../../backend/src/video/livekit-token-provider';
import { VideoSessionRepository } from '../../../backend/src/video/repository';
import { VideoSessionService } from '../../../backend/src/video/service';
import { closeAll, ownerPool, rolePools } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string };
type DataResponse = { data: { id: string; status?: string; token?: string } };

const googleProvider: GoogleIdentityProvider = {
  verifyIdToken: () =>
    Promise.reject(new Error('External Google verification is not used in this E2E')),
};

const firstId = (rows: IdRow[]): string => {
  const id = rows[0]?.id;
  if (!id) throw new Error('Expected fixture id');
  return id;
};

const bearer = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

const createEligibleUser = async (subject: string): Promise<string> => {
  const user = await ownerPool.query<IdRow>(
    `INSERT INTO users (google_subject_id, phone_verified, age_assurance_status)
     VALUES ($1, TRUE, 'APPROVED') RETURNING id`,
    [subject],
  );
  const userId = firstId(user.rows);
  await ownerPool.query(
    `INSERT INTO profiles (user_id, display_name, language, region)
     VALUES ($1, $2, 'pt-BR', 'BR')`,
    [userId, `E2E ${subject.slice(-6)}`],
  );
  return userId;
};

describe('critical protected HTTP path', () => {
  test('mutual consent permits a token, then block makes the same session unauthorized', async () => {
    const suffix = randomUUID();
    const userA = await createEligibleUser(`e2e-a-${suffix}`);
    const userB = await createEligibleUser(`e2e-b-${suffix}`);
    let intentId: string | null = null;
    let consentId: string | null = null;
    let videoSessionId: string | null = null;

    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const tokenProvider = new JwtSessionProvider({
      privateKeyPem: await exportPKCS8(privateKey),
      publicKeyPem: await exportSPKI(publicKey),
      keyId: 'e2e-current',
      issuer: 'https://e2e.vibematch.test',
      audience: 'vibematch-e2e',
    });

    const authRepository = new AuthRepository(rolePools.svc_auth);
    const authService = new AuthService(authRepository, googleProvider, tokenProvider, {
      sessionTtlSeconds: 15 * 60,
    });
    const ageService = new AgeAssuranceService(new AgeAssuranceRepository(rolePools.svc_profile));
    const matchService = new MatchIntentService(
      new MatchIntentRepository(rolePools.svc_matchmaking),
    );
    const consentService = new ConsentService(new ConsentRepository(rolePools.svc_matchmaking));
    const videoService = new VideoSessionService(
      new VideoSessionRepository(rolePools.svc_video),
      new LiveKitTokenProvider({ apiKey: 'e2e-key', apiSecret: 'e2e-secret-not-production' }),
    );
    const moderationService = new ModerationService(
      new ModerationRepository(rolePools.svc_moderation),
    );

    const app = buildApp({
      authService,
      sessionTokenVerifier: tokenProvider,
      activeSessionStore: authRepository,
      phoneStateStore: authRepository,
      ageAssuranceService: ageService,
      matchIntentService: matchService,
      consentService,
      videoSessionService: videoService,
      moderationService,
    });

    try {
      const sessionA = await ownerPool.query<IdRow>(
        `INSERT INTO auth_sessions (user_id, expires_at)
         VALUES ($1, now() + interval '15 minutes') RETURNING id`,
        [userA],
      );
      const sessionB = await ownerPool.query<IdRow>(
        `INSERT INTO auth_sessions (user_id, expires_at)
         VALUES ($1, now() + interval '15 minutes') RETURNING id`,
        [userB],
      );
      const sessionAId = firstId(sessionA.rows);
      const sessionBId = firstId(sessionB.rows);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const tokenA = await tokenProvider.issue(
        { userId: userA, sessionId: sessionAId, phoneVerified: true },
        expiresAt,
      );
      const tokenB = await tokenProvider.issue(
        { userId: userB, sessionId: sessionBId, phoneVerified: true },
        expiresAt,
      );

      const createdIntent = await app.inject({
        method: 'POST',
        url: '/api/match-intents',
        headers: bearer(tokenA),
        payload: { receiver_id: userB },
      });
      expect(createdIntent.statusCode).toBe(201);
      intentId = createdIntent.json<DataResponse>().data.id;

      const acceptedIntent = await app.inject({
        method: 'POST',
        url: `/api/match-intents/${intentId}/respond`,
        headers: bearer(tokenB),
        payload: { decision: 'ACCEPTED' },
      });
      expect(acceptedIntent.statusCode).toBe(200);

      const createdConsent = await app.inject({
        method: 'POST',
        url: '/api/consents',
        headers: bearer(tokenA),
        payload: { match_intent_id: intentId },
      });
      expect(createdConsent.statusCode).toBe(201);
      consentId = createdConsent.json<DataResponse>().data.id;

      const decisionA = await app.inject({
        method: 'POST',
        url: `/api/consents/${consentId}/decision`,
        headers: bearer(tokenA),
        payload: { decision: 'ACCEPTED', request_id: randomUUID() },
      });
      expect(decisionA.statusCode).toBe(200);

      const decisionB = await app.inject({
        method: 'POST',
        url: `/api/consents/${consentId}/decision`,
        headers: bearer(tokenB),
        payload: { decision: 'ACCEPTED', request_id: randomUUID() },
      });
      expect(decisionB.statusCode).toBe(200);
      expect(decisionB.json<DataResponse>().data.status).toBe('ACCEPTED_BOTH');

      const authorizationState = await ownerPool.query<{
        consent_status: string;
        video_deadline: Date | null;
        user_a_status: string;
        user_b_status: string;
        user_a_phone_verified: boolean;
        user_b_phone_verified: boolean;
        user_a_age_status: string;
        user_b_age_status: string;
      }>(
        `SELECT c.status AS consent_status,
                c.video_deadline,
                ua.status AS user_a_status,
                ub.status AS user_b_status,
                ua.phone_verified AS user_a_phone_verified,
                ub.phone_verified AS user_b_phone_verified,
                ua.age_assurance_status AS user_a_age_status,
                ub.age_assurance_status AS user_b_age_status
           FROM consents c
           JOIN users ua ON ua.id = c.user_a_id
           JOIN users ub ON ub.id = c.user_b_id
          WHERE c.id = $1`,
        [consentId],
      );
      expect(authorizationState.rows[0]).toMatchObject({
        consent_status: 'ACCEPTED_BOTH',
        user_a_status: 'ACTIVE',
        user_b_status: 'ACTIVE',
        user_a_phone_verified: true,
        user_b_phone_verified: true,
        user_a_age_status: 'APPROVED',
        user_b_age_status: 'APPROVED',
      });
      expect(authorizationState.rows[0]?.video_deadline?.getTime()).toBeGreaterThan(Date.now());

      const createdVideo = await app.inject({
        method: 'POST',
        url: '/api/video/sessions',
        headers: bearer(tokenA),
        payload: { consent_id: consentId },
      });
      if (createdVideo.statusCode !== 201) {
        throw new Error(`Video session create failed: ${createdVideo.body}`);
      }
      expect(createdVideo.statusCode).toBe(201);
      videoSessionId = createdVideo.json<DataResponse>().data.id;

      const beforeBlock = await app.inject({
        method: 'POST',
        url: `/api/video/sessions/${videoSessionId}/token`,
        headers: bearer(tokenA),
      });
      expect(beforeBlock.statusCode).toBe(200);
      expect(beforeBlock.json<DataResponse>().data.token).toBeTruthy();

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/blocks',
        headers: bearer(tokenA),
        payload: { blocked_id: userB },
      });
      expect(blocked.statusCode).toBe(201);

      const afterBlock = await app.inject({
        method: 'POST',
        url: `/api/video/sessions/${videoSessionId}/token`,
        headers: bearer(tokenA),
      });
      expect(afterBlock.statusCode).toBe(403);
      expect(afterBlock.json()).toEqual({ error: 'VIDEO_NOT_AUTHORIZED' });

      const state = await ownerPool.query<{
        status: string;
        end_reason: string | null;
        revocation_pending: boolean;
      }>('SELECT status, end_reason, revocation_pending FROM sessions WHERE id = $1', [
        videoSessionId,
      ]);
      expect(state.rows[0]).toEqual({
        status: 'ENDED',
        end_reason: 'BLOCK',
        revocation_pending: true,
      });
    } finally {
      await app.close();
      await ownerPool.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [
        userA,
        userB,
      ]);
      if (videoSessionId) {
        await ownerPool.query('DELETE FROM sessions WHERE id = $1', [videoSessionId]);
      }
      if (consentId) {
        await ownerPool.query('DELETE FROM consent_decisions WHERE consent_id = $1', [consentId]);
        await ownerPool.query('DELETE FROM consents WHERE id = $1', [consentId]);
      }
      if (intentId) await ownerPool.query('DELETE FROM match_intents WHERE id = $1', [intentId]);
      await ownerPool.query('DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])', [
        [userA, userB],
      ]);
      await ownerPool.query('DELETE FROM profiles WHERE user_id = ANY($1::uuid[])', [
        [userA, userB],
      ]);
      await ownerPool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userA, userB]]);
    }
  });
});
