import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { PhoneVerificationService } from '../auth/phone-service';
import { GoogleOidcProvider } from '../auth/providers/google';
import { JwtSessionProvider } from '../auth/providers/jwt';
import { TwilioVerifyProvider } from '../auth/providers/twilio-verify';
import { AuthRepository } from '../auth/repository';
import { AuthService } from '../auth/service';
import { createBillingRuntime, type BillingRuntime } from '../billing/factory';
import { registerBillingRoutes } from '../billing/http';
import { createChatService } from '../chat/factory';
import { env } from '../config/env';
import { ConsentRepository } from '../consent/repository';
import { ConsentService } from '../consent/service';
import { buildApp } from '../http/app';
import { MatchIntentRepository } from '../matchmaking/repository';
import { MatchIntentService } from '../matchmaking/service';
import { ModerationRepository } from '../moderation/repository';
import { ModerationService } from '../moderation/service';
import { registerAgeAssuranceRoutes } from '../profile/age-http';
import { AgeAssuranceRepository } from '../profile/age-assurance-repository';
import { AgeAssuranceService } from '../profile/age-assurance';
import { AgeWebhookReconciler } from '../profile/age-webhook-reconciler';
import { registerAgeWebhookRoute } from '../profile/age-webhook-http';
import { DiditAgeAssuranceProvider } from '../profile/providers/didit';
import { ProfileRepository } from '../profile/repository';
import { ProfileService } from '../profile/service';
import { createVideoRuntime, type VideoRuntime } from '../video/factory';

export type ProductionRuntime = {
  app: FastifyInstance;
  video: VideoRuntime;
  billing: BillingRuntime;
  reconcileVideoRevocations(): Promise<{ revoked: number; failed: number }>;
  close(): Promise<void>;
};

export const createProductionRuntime = (): ProductionRuntime => {
  const authPool = new Pool({ connectionString: env.authDatabaseUrl() });
  const profilePool = new Pool({ connectionString: env.profileDatabaseUrl() });
  const matchmakingPool = new Pool({ connectionString: env.matchmakingDatabaseUrl() });
  const moderationPool = new Pool({ connectionString: env.moderationDatabaseUrl() });

  const authRepository = new AuthRepository(authPool);
  const sessionTokens = new JwtSessionProvider({
    privateKeyPem: env.jwtPrivateKeyPem(),
    publicKeyPem: env.jwtPublicKeyPem(),
    issuer: env.jwtIssuer(),
    audience: env.jwtAudience(),
  });
  const authService = new AuthService(
    authRepository,
    new GoogleOidcProvider(env.googleOidcAudience()),
    sessionTokens,
    { sessionTtlSeconds: env.authSessionTtlSeconds },
  );
  const phoneVerificationService = new PhoneVerificationService(
    authRepository,
    new TwilioVerifyProvider({
      accountSid: env.twilioAccountSid(),
      authToken: env.twilioAuthToken(),
      serviceSid: env.twilioVerifyServiceSid(),
      baseUrl: env.twilioVerifyBaseUrl(),
    }),
    { phoneHashPepper: env.phoneHashPepper() },
  );

  const profileService = new ProfileService(new ProfileRepository(profilePool));
  const diditProvider = new DiditAgeAssuranceProvider({
    apiKey: env.diditApiKey(),
    workflowId: env.diditWorkflowId(),
    baseUrl: env.diditApiBaseUrl(),
  });
  const ageAssuranceService = new AgeAssuranceService(
    new AgeAssuranceRepository(profilePool),
    diditProvider,
  );
  const ageWebhookReconciler = new AgeWebhookReconciler(profilePool, diditProvider);
  const matchIntentService = new MatchIntentService(new MatchIntentRepository(matchmakingPool));
  const consentService = new ConsentService(new ConsentRepository(matchmakingPool));
  const moderationService = new ModerationService(new ModerationRepository(moderationPool));
  const video = createVideoRuntime();
  const billing = createBillingRuntime();
  const chatService = createChatService();

  const app = buildApp({
    authService,
    sessionTokenVerifier: sessionTokens,
    activeSessionStore: authRepository,
    phoneStateStore: authRepository,
    phoneVerificationService,
    profileService,
    ageAssuranceService,
    matchIntentService,
    consentService,
    videoSessionService: video.sessionService,
    moderationService,
    chatService,
  });

  registerAgeAssuranceRoutes(app, {
    service: ageAssuranceService,
    sessionTokenVerifier: sessionTokens,
    activeSessionStore: authRepository,
  });

  registerAgeWebhookRoute(app, {
    webhookSecret: env.diditWebhookSecret(),
    reconciler: ageWebhookReconciler,
  });

  registerBillingRoutes(app, {
    service: billing.service,
    sessionTokenVerifier: sessionTokens,
    activeSessionStore: authRepository,
    rtdnVerifier: billing.rtdnVerifier,
    googlePlayPackageName: billing.packageName,
  });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;

    const results = await Promise.allSettled([
      app.close(),
      billing.close(),
      video.close(),
      moderationPool.end(),
      matchmakingPool.end(),
      profilePool.end(),
      authPool.end(),
    ]);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (rejected) throw rejected.reason;
  };

  return {
    app,
    video,
    billing,
    reconcileVideoRevocations: () => video.revocationService.reconcile(),
    close,
  };
};
