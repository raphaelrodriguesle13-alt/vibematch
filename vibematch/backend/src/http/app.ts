import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { SessionTokenClaims, SessionTokenVerifier } from '../shared/providers';
import { ChatRequestValidationError, type ChatRequest, type ChatService } from '../chat/service';
import { ChatGptProviderError } from '../shared/providers/openai';
import { AuthError, type AuthService } from '../auth/service';
import type { AuthSession } from '../auth/repository';
import { PhoneVerificationError, type PhoneVerificationService } from '../auth/phone-service';

export interface ActiveSessionStore {
  findActiveSession(userId: string, sessionId: string, now: Date): Promise<AuthSession | null>;
  touchSession(userId: string, sessionId: string, seenAt: Date): Promise<void>;
}

export interface AuthHttpDependencies {
  authService: Pick<AuthService, 'loginWithGoogle' | 'logout'>;
  sessionTokenVerifier: SessionTokenVerifier;
  activeSessionStore: ActiveSessionStore;
  phoneVerificationService?: Pick<PhoneVerificationService, 'start' | 'confirm'>;
  chatService?: Pick<ChatService, 'respond'>;
  now?: () => Date;
}

type GoogleLoginBody = { google_id_token?: unknown };
type PhoneStartBody = { phone_e164?: unknown };
type PhoneConfirmBody = { verification_id?: unknown; code?: unknown };
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

  app.post<{ Body: ChatBody }>('/api/chat', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
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
