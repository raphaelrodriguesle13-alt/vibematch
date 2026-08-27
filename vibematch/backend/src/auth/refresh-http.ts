import type { FastifyInstance } from 'fastify';
import { AuthError, type AuthService } from './service';

type RefreshBody = { refresh_token?: unknown };

export type RefreshHttpDependencies = {
  authService: Pick<AuthService, 'refresh' | 'logoutWithRefresh'>;
};

const refreshTokenFromBody = (body: RefreshBody | undefined): string | null => {
  const refreshToken = body?.refresh_token;
  return typeof refreshToken === 'string' && refreshToken.trim() !== '' ? refreshToken : null;
};

export const registerRefreshRoute = (app: FastifyInstance, deps: RefreshHttpDependencies): void => {
  app.post<{ Body: RefreshBody }>('/auth/refresh', async (request, reply) => {
    const refreshToken = refreshTokenFromBody(request.body);
    if (!refreshToken) {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }

    try {
      const result = await deps.authService.refresh(refreshToken);
      return reply.code(200).send({
        session_jwt: result.sessionJwt,
        refresh_token: result.refreshToken,
        user_id: result.userId,
        phone_verified: result.phoneVerified,
        expires_at: result.expiresAt.toISOString(),
        refresh_expires_at: result.refreshExpiresAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof AuthError) {
        if (error.code === 'INVALID_REFRESH_TOKEN') {
          return reply.code(401).send({ error: error.code });
        }
        return reply.code(503).send({ error: error.code });
      }
      request.log.error({ err: error }, 'auth/refresh failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  app.post<{ Body: RefreshBody }>('/auth/logout/refresh', async (request, reply) => {
    const refreshToken = refreshTokenFromBody(request.body);
    if (!refreshToken) {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }

    try {
      await deps.authService.logoutWithRefresh(refreshToken);
    } catch (error) {
      request.log.error({ err: error }, 'auth/logout/refresh failed');
    }

    return reply.code(200).send({ ok: true });
  });
};
