import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionTokenVerifier } from '../shared/providers';
import type { ActiveSessionStore } from '../http/app';
import { AccountDeletionError, type AccountDeletionService } from './service';

export type AccountDeletionHttpDependencies = {
  service: Pick<AccountDeletionService, 'requestDeletion'>;
  sessionTokenVerifier: SessionTokenVerifier;
  activeSessionStore: ActiveSessionStore;
  now?: () => Date;
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
  deps: AccountDeletionHttpDependencies,
): Promise<{ userId: string } | null> => {
  const token = bearerToken(request);
  if (!token) {
    await reply.code(401).send({ error: 'UNAUTHORIZED' });
    return null;
  }

  try {
    const claims = await deps.sessionTokenVerifier.verify(token);
    const now = (deps.now ?? (() => new Date()))();
    const session = await deps.activeSessionStore.findActiveSession(
      claims.userId,
      claims.sessionId,
      now,
    );
    if (!session) {
      await reply.code(401).send({ error: 'SESSION_REVOKED_OR_EXPIRED' });
      return null;
    }
    await deps.activeSessionStore.touchSession(claims.userId, claims.sessionId, now);
    return { userId: claims.userId };
  } catch {
    await reply.code(401).send({ error: 'UNAUTHORIZED' });
    return null;
  }
};

export const registerAccountDeletionRoute = (
  app: FastifyInstance,
  deps: AccountDeletionHttpDependencies,
): void => {
  app.delete('/api/account', async (request, reply) => {
    const auth = await authenticate(request, reply, deps);
    if (!auth) return;

    try {
      const status = await deps.service.requestDeletion(auth.userId);
      return reply.code(202).send({ ok: true, status });
    } catch (error) {
      if (error instanceof AccountDeletionError) {
        return reply.code(503).send({ error: error.code });
      }
      request.log.error({ err: error }, 'api/account deletion failed');
      return reply.code(503).send({ error: 'ACCOUNT_DELETION_UNAVAILABLE' });
    }
  });
};
