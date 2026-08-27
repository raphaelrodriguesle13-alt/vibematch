import type { FastifyInstance } from 'fastify';
import {
  diditSessionRef,
  type DiditWebhookBody,
  verifyDiditWebhookV2,
} from './didit-webhook';
import type { AgeWebhookReconciler } from './age-webhook-reconciler';

export type AgeWebhookHttpDependencies = {
  webhookSecret: string;
  reconciler: Pick<AgeWebhookReconciler, 'reconcileProviderSession'>;
  now?: () => Date;
};

export const registerAgeWebhookRoute = (
  app: FastifyInstance,
  deps: AgeWebhookHttpDependencies,
): void => {
  const now = deps.now ?? (() => new Date());

  app.post('/api/age-assurance/webhook', async (request, reply) => {
    const body = request.body as DiditWebhookBody;
    const signature = request.headers['x-signature-v2'];
    const timestamp = request.headers['x-timestamp'];
    const signatureValue = Array.isArray(signature) ? signature[0] : signature;
    const timestampValue = Array.isArray(timestamp) ? timestamp[0] : timestamp;

    if (
      !body ||
      typeof body !== 'object' ||
      !verifyDiditWebhookV2(body, signatureValue, timestampValue, deps.webhookSecret, now())
    ) {
      return reply.code(401).send({ error: 'INVALID_WEBHOOK_SIGNATURE' });
    }

    const providerSessionRef = diditSessionRef(body);
    if (!providerSessionRef) {
      return reply.code(400).send({ error: 'INVALID_WEBHOOK_PAYLOAD' });
    }

    try {
      const result = await deps.reconciler.reconcileProviderSession(providerSessionRef);
      if (result.outcome === 'SESSION_NOT_FOUND') {
        return reply.code(503).send({ error: 'AGE_SESSION_NOT_READY' });
      }
      return reply.code(200).send({ data: { accepted: true } });
    } catch (error) {
      request.log.error({ err: error }, 'age assurance webhook reconciliation failed');
      return reply.code(503).send({ error: 'AGE_PROVIDER_UNAVAILABLE' });
    }
  });
};
