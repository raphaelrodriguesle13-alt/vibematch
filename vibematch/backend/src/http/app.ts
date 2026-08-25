import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { SessionTokenClaims, SessionTokenVerifier } from '../shared/providers';
import { AuthError, type AuthService } from '../auth/service';
import type { AuthSession } from '../auth/repository';

export interface ActiveSessionStore {
  findActiveSession(userId: string, sessionId: string, now: Date): Promise<AuthSession | null>;
  touchSession(userId: string, sessionId: string, seenAt: Date): Promise<void>;
}

export interface AuthHttpDependencies {
  authService: Pick<AuthService, 'loginWithGoogle' | 'logout'>;
  sessionTokenVerifier: SessionTokenVerifier;
  activeSessionStore: ActiveSessionStore;
  now?: () => Date;
}

type GoogleLoginBody = { google_id_token?: unknown };

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

export const buildApp = (deps: AuthHttpDependencies): FastifyInstance => {
  const app = fastify({ logger: false });
  const now = deps.now ?? (() => new Date());

  app.get('/health', async () => ({ ok: true }));

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

  return app;
};
