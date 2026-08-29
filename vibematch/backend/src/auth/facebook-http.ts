import type { FastifyInstance } from 'fastify';
import { ProviderAuthError, type ProviderAuthService } from './provider-service';
import type { AuthRateLimiter } from './rate-limit';

type FacebookLoginBody = { access_token?: unknown };

type FacebookHttpDependencies = {
  service: Pick<ProviderAuthService, 'login'> | null;
  rateLimiter?: AuthRateLimiter;
  now?: () => Date;
};

export const registerFacebookLoginRoute = (
  app: FastifyInstance,
  deps: FacebookHttpDependencies,
): void => {
  const now = deps.now ?? (() => new Date());

  app.post<{ Body: FacebookLoginBody }>('/auth/facebook', async (request, reply) => {
    if (!deps.service) {
      return reply.code(503).send({ error: 'FACEBOOK_NOT_CONFIGURED' });
    }

    const accessToken = request.body?.access_token;
    if (typeof accessToken !== 'string' || accessToken.trim() === '') {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }

    if (deps.rateLimiter) {
      try {
        const decision = await deps.rateLimiter.consume('FACEBOOK_LOGIN', accessToken, now());
        if (!decision.allowed) {
          reply.header('Retry-After', decision.retryAfterSeconds.toString());
          return reply.code(429).send({ error: 'RATE_LIMITED' });
        }
      } catch (error) {
        request.log.error({ err: error }, 'auth/facebook rate limiter unavailable');
        return reply.code(503).send({ error: 'AUTH_RATE_LIMIT_UNAVAILABLE' });
      }
    }

    try {
      const result = await deps.service.login(accessToken);
      return reply.code(200).send({
        session_jwt: result.sessionJwt,
        refresh_token: result.refreshToken,
        user_id: result.userId,
        is_new_user: result.isNewUser,
        phone_verified: result.phoneVerified,
        expires_at: result.expiresAt.toISOString(),
        refresh_expires_at: result.refreshExpiresAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof ProviderAuthError) {
        if (error.code === 'INVALID_PROVIDER_TOKEN') {
          return reply.code(401).send({ error: 'INVALID_FACEBOOK_TOKEN' });
        }
        if (error.code === 'ACCOUNT_UNAVAILABLE') {
          return reply.code(403).send({ error: error.code });
        }
        return reply.code(503).send({ error: error.code });
      }
      request.log.error({ err: error }, 'auth/facebook failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });
};
