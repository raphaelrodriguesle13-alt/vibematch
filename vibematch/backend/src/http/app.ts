import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { SessionTokenClaims, SessionTokenVerifier } from '../shared/providers';
import { ChatRequestValidationError, type ChatRequest, type ChatService } from '../chat/service';
import { ChatGptProviderError } from '../shared/providers/openai';
import { AuthError, type AuthService } from '../auth/service';
import type { AuthSession } from '../auth/repository';
import { PhoneVerificationError, type PhoneVerificationService } from '../auth/phone-service';
import type { AgeAssuranceService } from '../profile/age-assurance';
import {
  ProfileError,
  type ProfileService,
  type UpdateProfileInput,
  type UserProfile,
} from '../profile/service';
import {
  MatchIntentError,
  type MatchIntent,
  type MatchIntentService,
} from '../matchmaking/service';

export interface ActiveSessionStore {
  findActiveSession(userId: string, sessionId: string, now: Date): Promise<AuthSession | null>;
  touchSession(userId: string, sessionId: string, seenAt: Date): Promise<void>;
}

export interface AuthHttpDependencies {
  authService: Pick<AuthService, 'loginWithGoogle' | 'logout'>;
  sessionTokenVerifier: SessionTokenVerifier;
  activeSessionStore: ActiveSessionStore;
  phoneVerificationService?: Pick<PhoneVerificationService, 'start' | 'confirm'>;
  profileService?: Pick<ProfileService, 'get' | 'update' | 'listInterests'>;
  ageAssuranceService?: Pick<AgeAssuranceService, 'getStatus' | 'isApproved'>;
  matchIntentService?: Pick<MatchIntentService, 'create' | 'listIncoming' | 'respond'>;
  chatService?: Pick<ChatService, 'respond'>;
  now?: () => Date;
}

type GoogleLoginBody = { google_id_token?: unknown };
type PhoneStartBody = { phone_e164?: unknown };
type PhoneConfirmBody = { verification_id?: unknown; code?: unknown };
type ProfileBody = {
  display_name?: unknown;
  avatar_url?: unknown;
  language?: unknown;
  region?: unknown;
  interest_ids?: unknown;
};
type MatchIntentCreateBody = { receiver_id?: unknown };
type MatchIntentRespondBody = { decision?: unknown };
type MatchIntentParams = { id: string };
type ChatBody = { message?: unknown; history?: unknown };

type AuthenticatedRequest = {
  claims: SessionTokenClaims;
};

const bearerToken = (request: FastifyRequest): string | null => {
  const authorization = request.headers.authorization;
  if (!authorization) return null;
  const [scheme, token, ...rest] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) return null;
  return token;
};

const authenticate = async (
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AuthHttpDependencies,
  now: () => Date,
): Promise<AuthenticatedRequest | null> => {
  const token = bearerToken(request);
  if (!token) {
    await reply.code(401).send({ error: 'UNAUTHORIZED' });
    return null;
  }

  try {
    const claims = await deps.sessionTokenVerifier.verify(token);
    const session = await deps.activeSessionStore.findActiveSession(
      claims.userId,
      claims.sessionId,
      now(),
    );
    if (!session) {
      await reply.code(401).send({ error: 'SESSION_REVOKED_OR_EXPIRED' });
      return null;
    }
    await deps.activeSessionStore.touchSession(claims.userId, claims.sessionId, now());
    return { claims };
  } catch {
    await reply.code(401).send({ error: 'UNAUTHORIZED' });
    return null;
  }
};

const requireAgeApproved = async (
  userId: string,
  reply: FastifyReply,
  deps: AuthHttpDependencies,
): Promise<boolean> => {
  if (!deps.ageAssuranceService) {
    await reply.code(503).send({ error: 'AGE_ASSURANCE_NOT_CONFIGURED' });
    return false;
  }
  if (!(await deps.ageAssuranceService.isApproved(userId))) {
    await reply.code(403).send({ error: 'AGE_ASSURANCE_REQUIRED' });
    return false;
  }
  return true;
};

const phoneErrorStatus = (error: PhoneVerificationError): number => {
  switch (error.code) {
    case 'INVALID_PHONE':
    case 'INVALID_CODE':
      return 400;
    case 'VERIFICATION_NOT_AVAILABLE':
      return 404;
    case 'TOO_MANY_ATTEMPTS':
      return 429;
    case 'SMS_PROVIDER_UNAVAILABLE':
      return 503;
  }
};

const matchIntentErrorStatus = (error: MatchIntentError): number => {
  switch (error.code) {
    case 'INVALID_TARGET':
      return 400;
    case 'NOT_ELIGIBLE':
      return 409;
    case 'INTENT_NOT_AVAILABLE':
      return 404;
  }
};

const serializeProfile = (profile: UserProfile) => ({
  user_id: profile.userId,
  display_name: profile.displayName,
  avatar_url: profile.avatarUrl,
  language: profile.language,
  region: profile.region,
  interests: profile.interests,
});

const serializeMatchIntent = (intent: MatchIntent) => ({
  id: intent.id,
  sender_id: intent.senderId,
  receiver_id: intent.receiverId,
  status: intent.status,
  expires_at: intent.expiresAt.toISOString(),
  responded_at: intent.respondedAt?.toISOString() ?? null,
  closed_at: intent.closedAt?.toISOString() ?? null,
  created_at: intent.createdAt.toISOString(),
});

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');

const parseProfileBody = (body: ProfileBody | undefined): UpdateProfileInput | null => {
  if (
    typeof body?.display_name !== 'string' ||
    typeof body.language !== 'string' ||
    typeof body.region !== 'string'
  ) {
    return null;
  }

  const avatarUrl = body.avatar_url;
  if (avatarUrl !== undefined && avatarUrl !== null && typeof avatarUrl !== 'string') {
    return null;
  }

  const interestIds = body.interest_ids;
  if (interestIds !== undefined && !isStringArray(interestIds)) {
    return null;
  }

  return {
    displayName: body.display_name,
    language: body.language,
    region: body.region,
    ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    ...(interestIds !== undefined ? { interestIds } : {}),
  };
};

export const buildApp = (deps: AuthHttpDependencies): FastifyInstance => {
  const app = fastify({ logger: false });
  const now = deps.now ?? (() => new Date());

  app.get('/health', () => ({ ok: true }));

  app.post<{ Body: GoogleLoginBody }>('/auth/google', async (request, reply) => {
    const googleIdToken = request.body?.google_id_token;
    if (typeof googleIdToken !== 'string' || googleIdToken.trim() === '') {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }

    try {
      const result = await deps.authService.loginWithGoogle(googleIdToken);
      return reply.code(200).send({
        session_jwt: result.sessionJwt,
        user_id: result.userId,
        is_new_user: result.isNewUser,
        phone_verified: result.phoneVerified,
        expires_at: result.expiresAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof AuthError) {
        if (error.code === 'INVALID_GOOGLE_TOKEN') {
          return reply.code(401).send({ error: error.code });
        }
        if (error.code === 'ACCOUNT_UNAVAILABLE') {
          return reply.code(403).send({ error: error.code });
        }
        return reply.code(503).send({ error: error.code });
      }
      request.log.error({ err: error }, 'auth/google failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/auth/logout', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
    await deps.authService.logout(auth.claims.userId, auth.claims.sessionId);
    return reply.code(200).send({ ok: true });
  });

  app.post<{ Body: PhoneStartBody }>('/auth/phone/start', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
    if (!deps.phoneVerificationService) {
      return reply.code(503).send({ error: 'PHONE_VERIFICATION_NOT_CONFIGURED' });
    }

    const phone = request.body?.phone_e164;
    if (typeof phone !== 'string') {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }

    try {
      const result = await deps.phoneVerificationService.start(auth.claims.userId, phone);
      return reply.code(200).send({
        verification_id: result.verificationId,
        expires_at: result.expiresAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof PhoneVerificationError) {
        return reply.code(phoneErrorStatus(error)).send({ error: error.code });
      }
      request.log.error({ err: error }, 'auth/phone/start failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  app.post<{ Body: PhoneConfirmBody }>('/auth/phone/confirm', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
    if (!deps.phoneVerificationService) {
      return reply.code(503).send({ error: 'PHONE_VERIFICATION_NOT_CONFIGURED' });
    }

    const verificationId = request.body?.verification_id;
    const code = request.body?.code;
    if (typeof verificationId !== 'string' || typeof code !== 'string') {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }

    try {
      const result = await deps.phoneVerificationService.confirm(
        auth.claims.userId,
        verificationId,
        code,
      );
      return reply.code(200).send({ ok: result.ok, phone_verified: result.phoneVerified });
    } catch (error) {
      if (error instanceof PhoneVerificationError) {
        return reply.code(phoneErrorStatus(error)).send({ error: error.code });
      }
      request.log.error({ err: error }, 'auth/phone/confirm failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  app.get('/api/profile', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
    if (!deps.profileService) {
      return reply.code(503).send({ error: 'PROFILE_NOT_CONFIGURED' });
    }

    const profile = await deps.profileService.get(auth.claims.userId);
    if (!profile) return reply.code(404).send({ error: 'PROFILE_NOT_FOUND' });
    return reply.code(200).send({ data: serializeProfile(profile) });
  });

  app.get('/api/interests', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
    if (!deps.profileService) {
      return reply.code(503).send({ error: 'PROFILE_NOT_CONFIGURED' });
    }

    const interests = await deps.profileService.listInterests();
    return reply.code(200).send({ data: interests });
  });

  app.put<{ Body: ProfileBody }>('/api/profile', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
    if (!deps.profileService) {
      return reply.code(503).send({ error: 'PROFILE_NOT_CONFIGURED' });
    }

    const input = parseProfileBody(request.body);
    if (!input) return reply.code(400).send({ error: 'INVALID_REQUEST' });

    try {
      const profile = await deps.profileService.update(auth.claims.userId, input);
      return reply.code(200).send({ data: serializeProfile(profile) });
    } catch (error) {
      if (error instanceof ProfileError) {
        return reply.code(400).send({ error: error.code });
      }
      request.log.error({ err: error }, 'api/profile failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  app.get('/api/age-assurance/status', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
    if (!deps.ageAssuranceService) {
      return reply.code(503).send({ error: 'AGE_ASSURANCE_NOT_CONFIGURED' });
    }

    const status = await deps.ageAssuranceService.getStatus(auth.claims.userId);
    if (!status) return reply.code(404).send({ error: 'ACCOUNT_NOT_FOUND' });
    return reply.code(200).send({ data: { status } });
  });

  app.post<{ Body: MatchIntentCreateBody }>('/api/match-intents', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
    if (!(await requireAgeApproved(auth.claims.userId, reply, deps))) return;
    if (!deps.matchIntentService) {
      return reply.code(503).send({ error: 'MATCHMAKING_NOT_CONFIGURED' });
    }

    const receiverId = request.body?.receiver_id;
    if (typeof receiverId !== 'string') {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }
    try {
      const intent = await deps.matchIntentService.create(auth.claims.userId, receiverId);
      return reply.code(201).send({ data: serializeMatchIntent(intent) });
    } catch (error) {
      if (error instanceof MatchIntentError) {
        return reply.code(matchIntentErrorStatus(error)).send({ error: error.code });
      }
      request.log.error({ err: error }, 'api/match-intents create failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  app.get('/api/match-intents/incoming', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
    if (!(await requireAgeApproved(auth.claims.userId, reply, deps))) return;
    if (!deps.matchIntentService) {
      return reply.code(503).send({ error: 'MATCHMAKING_NOT_CONFIGURED' });
    }

    const intents = await deps.matchIntentService.listIncoming(auth.claims.userId);
    return reply.code(200).send({ data: intents.map(serializeMatchIntent) });
  });

  app.post<{ Params: MatchIntentParams; Body: MatchIntentRespondBody }>(
    '/api/match-intents/:id/respond',
    async (request, reply) => {
      const auth = await authenticate(request, reply, deps, now);
      if (!auth) return;
      if (!(await requireAgeApproved(auth.claims.userId, reply, deps))) return;
      if (!deps.matchIntentService) {
        return reply.code(503).send({ error: 'MATCHMAKING_NOT_CONFIGURED' });
      }

      const decision = request.body?.decision;
      if (decision !== 'ACCEPTED' && decision !== 'DECLINED') {
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      }
      try {
        const intent = await deps.matchIntentService.respond(
          auth.claims.userId,
          request.params.id,
          decision,
        );
        return reply.code(200).send({ data: serializeMatchIntent(intent) });
      } catch (error) {
        if (error instanceof MatchIntentError) {
          return reply.code(matchIntentErrorStatus(error)).send({ error: error.code });
        }
        request.log.error({ err: error }, 'api/match-intents respond failed');
        return reply.code(500).send({ error: 'INTERNAL_ERROR' });
      }
    },
  );

  app.post<{ Body: ChatBody }>('/api/chat', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
    if (!(await requireAgeApproved(auth.claims.userId, reply, deps))) return;
    if (!deps.chatService) {
      return reply.code(503).send({ error: 'CHAT_NOT_CONFIGURED' });
    }

    try {
      const result = await deps.chatService.respond(request.body as ChatRequest);
      return reply.code(200).send({
        data: {
          request_id: result.requestId,
          model: result.model,
          text: result.text,
        },
      });
    } catch (error) {
      if (error instanceof ChatRequestValidationError) {
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      }
      if (error instanceof ChatGptProviderError) {
        if (error.kind === 'timeout') {
          return reply.code(504).send({ error: 'CHAT_PROVIDER_TIMEOUT' });
        }
        request.log.error(
          { kind: error.kind, statusCode: error.statusCode },
          'chat provider failed',
        );
        return reply.code(502).send({ error: 'CHAT_PROVIDER_UNAVAILABLE' });
      }
      request.log.error({ err: error }, 'api/chat failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  return app;
};
