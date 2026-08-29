import type { FastifyInstance } from 'fastify';
import { PhoneLoginError, type PhoneLoginService } from './phone-login-service';

type PhoneLoginStartBody = { phone_e164?: unknown };
type PhoneLoginConfirmBody = { verification_id?: unknown; code?: unknown };

export const registerPhoneLoginRoutes = (
  app: FastifyInstance,
  service: Pick<PhoneLoginService, 'start' | 'confirm'>,
): void => {
  app.post<{ Body: PhoneLoginStartBody }>('/auth/phone-login/start', async (request, reply) => {
    const phone = request.body?.phone_e164;
    if (typeof phone !== 'string') {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }

    try {
      const result = await service.start(phone);
      return reply.code(201).send({
        verification_id: result.verificationId,
        expires_at: result.expiresAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof PhoneLoginError) {
        if (error.code === 'INVALID_PHONE') {
          return reply.code(400).send({ error: error.code });
        }
        if (error.code === 'TOO_MANY_ATTEMPTS') {
          return reply.code(429).send({ error: error.code });
        }
        if (error.code === 'SMS_PROVIDER_UNAVAILABLE') {
          return reply.code(503).send({ error: error.code });
        }
      }
      request.log.error({ err: error }, 'auth/phone-login/start failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  app.post<{ Body: PhoneLoginConfirmBody }>('/auth/phone-login/confirm', async (request, reply) => {
    const verificationId = request.body?.verification_id;
    const code = request.body?.code;
    if (typeof verificationId !== 'string' || typeof code !== 'string') {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }

    try {
      const result = await service.confirm(verificationId, code);
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
      if (error instanceof PhoneLoginError) {
        if (error.code === 'INVALID_CODE') {
          return reply.code(401).send({ error: error.code });
        }
        if (error.code === 'LOGIN_NOT_AVAILABLE') {
          return reply.code(410).send({ error: error.code });
        }
        if (error.code === 'TOO_MANY_ATTEMPTS') {
          return reply.code(429).send({ error: error.code });
        }
        if (error.code === 'SMS_PROVIDER_UNAVAILABLE' || error.code === 'SESSION_ISSUANCE_FAILED') {
          return reply.code(503).send({ error: error.code });
        }
        if (error.code === 'ACCOUNT_UNAVAILABLE') {
          return reply.code(403).send({ error: error.code });
        }
      }
      request.log.error({ err: error }, 'auth/phone-login/confirm failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });
};
