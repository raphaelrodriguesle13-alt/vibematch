import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionTokenClaims, SessionTokenVerifier } from '../shared/providers';
import { BillingError, type BillingService, type SubscriptionEntitlement } from './service';
import { parseRtdnEnvelope, type PubSubPushVerifier } from './rtdn';

export interface BillingActiveSessionStore {
  findActiveSession(
    userId: string,
    sessionId: string,
    now: Date,
  ): Promise<{ id: string } | null>;
  touchSession(userId: string, sessionId: string, seenAt: Date): Promise<void>;
}

export type BillingHttpDependencies = {
  service: Pick<BillingService, 'verifyPurchase' | 'getEntitlement' | 'processRtdn'>;
  sessionTokenVerifier: SessionTokenVerifier;
  activeSessionStore: BillingActiveSessionStore;
  rtdnVerifier: Pick<PubSubPushVerifier, 'verifyAuthorizationHeader'>;
  googlePlayPackageName: string;
  now?: () => Date;
};

type VerifyPurchaseBody = { purchase_token?: unknown };
type Authenticated = { claims: SessionTokenClaims };

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
  deps: BillingHttpDependencies,
  now: () => Date,
): Promise<Authenticated | null> => {
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

const serializeEntitlement = (entitlement: SubscriptionEntitlement | null) => ({
  entitled: entitlement?.entitled ?? false,
  plan: entitlement?.plan ?? null,
  status: entitlement?.status ?? null,
  current_period_end: entitlement?.currentPeriodEnd.toISOString() ?? null,
});

const billingErrorStatus = (error: BillingError): number => {
  switch (error.code) {
    case 'INVALID_BILLING_REQUEST':
      return 400;
    case 'ACCOUNT_UNAVAILABLE':
      return 403;
    case 'PURCHASE_NOT_OWNED':
      return 409;
    case 'PLAY_VERIFICATION_FAILED':
      return 503;
  }
};

export const registerBillingRoutes = (
  app: FastifyInstance,
  deps: BillingHttpDependencies,
): void => {
  const now = deps.now ?? (() => new Date());

  app.get('/api/billing/entitlement', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
    try {
      const entitlement = await deps.service.getEntitlement(auth.claims.userId);
      return reply.code(200).send({ data: serializeEntitlement(entitlement) });
    } catch (error) {
      if (error instanceof BillingError) {
        return reply.code(billingErrorStatus(error)).send({ error: error.code });
      }
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  app.post<{ Body: VerifyPurchaseBody }>('/api/billing/verify-purchase', async (request, reply) => {
    const auth = await authenticate(request, reply, deps, now);
    if (!auth) return;
    const purchaseToken = request.body?.purchase_token;
    if (typeof purchaseToken !== 'string' || !purchaseToken.trim()) {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }
    try {
      const entitlement = await deps.service.verifyPurchase(auth.claims.userId, purchaseToken);
      return reply.code(200).send({ data: serializeEntitlement(entitlement) });
    } catch (error) {
      if (error instanceof BillingError) {
        return reply.code(billingErrorStatus(error)).send({ error: error.code });
      }
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/webhooks/google-play/rtdn', async (request, reply) => {
    try {
      await deps.rtdnVerifier.verifyAuthorizationHeader(request.headers.authorization);
    } catch {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }
    let parsed;
    try {
      parsed = parseRtdnEnvelope(request.body, deps.googlePlayPackageName);
    } catch {
      return reply.code(400).send({ error: 'INVALID_RTDN_PAYLOAD' });
    }
    try {
      const result = await deps.service.processRtdn(parsed);
      return reply.code(200).send({ ok: true, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof BillingError && error.code === 'PLAY_VERIFICATION_FAILED') {
        return reply.code(503).send({ error: error.code });
      }
      if (error instanceof BillingError) {
        return reply.code(400).send({ error: error.code });
      }
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });
};
