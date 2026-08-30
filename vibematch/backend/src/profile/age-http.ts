import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthSession } from '../auth/repository';
import type { SessionTokenClaims, SessionTokenVerifier } from '../shared/providers';
import { AgeAssuranceError, type AgeAssuranceService } from './age-assurance';

export type AgeAssuranceHttpDependencies = {
  service: Pick<AgeAssuranceService, 'start' | 'refresh'>;
  sessionTokenVerifier: SessionTokenVerifier;
  activeSessionStore: {
    findActiveSession(userId: string, sessionId: string, now: Date): Promise<AuthSession | null>;
    touchSession(userId: string, sessionId: string, seenAt: Date): Promise<void>;
  };
  now?: () => Date;
};

type Authenticated = { claims: SessionTokenClaims };

const authenticate = async (
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AgeAssuranceHttpDependencies,
  now: () => Date,
): Promise<Authenticated | null> => {
  const authorization = request.headers.authorization;
  if (!authorization) {
    await reply.code(401).send({ error: 'UNAUTHORIZED' });
    return null;
  }
  const [scheme, token, ...rest] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
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

const statusCode = (error: AgeAssuranceError): number => {
  switch (error.code) {
    case 'ACCOUNT_UNAVAILABLE':
      return 403;
    case 'AGE_SESSION_NOT_AVAILABLE':
      return 404;
    case 'AGE_PROVIDER_UNAVAILABLE':
      return 503;
  }
};

const logProviderFailure = (request: FastifyRequest, error: AgeAssuranceError, action: string): void => {
  if (error.code !== 'AGE_PROVIDER_UNAVAILABLE') return;
  request.log.error(
    { provider_error: error.message, action },
    'age assurance provider unavailable',
  );
};

export const registerAgeAssuranceRoutes = (
  app: FastifyInstance,
  deps: AgeAssuranceHttpDependencies,
): void => {
  const now = deps.now ?? (() => new Date());

  app.post('/api/age-assurance/start', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
    try {
      const result = await deps.service.start(auth.claims.userId);
      return reply.code(200).send({
        data: {
          status: result.status,
          verification_url: result.verificationUrl,
        },
      });
    } catch (error) {
      if (error instanceof AgeAssuranceError) {
        logProviderFailure(request, error, 'start');
        return reply.code(statusCode(error)).send({ error: error.code });
      }
      request.log.error({ err: error }, 'age assurance start failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/api/age-assurance/refresh', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
    try {
      const status = await deps.service.refresh(auth.claims.userId);
      return reply.code(200).send({ data: { status } });
    } catch (error) {
      if (error instanceof AgeAssuranceError) {
        logProviderFailure(request, error, 'refresh');
        return reply.code(statusCode(error)).send({ error: error.code });
      }
      request.log.error({ err: error }, 'age assurance refresh failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });
};
