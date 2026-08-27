import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface StructuredLogSink {
  info(entry: Readonly<Record<string, unknown>>): void;
  error(entry: Readonly<Record<string, unknown>>): void;
}

export interface HttpObservabilityOptions {
  logger?: StructuredLogSink;
  readiness?: () => Promise<boolean>;
  nowMs?: () => number;
  requestId?: () => string;
}

const SENSITIVE_KEY =
  /authorization|cookie|token|jwt|password|secret|private.?key|api.?key|auth.?token|phone|code/i;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export const redactSensitive = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value === null || typeof value !== 'object') return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(child);
  }
  return redacted;
};

export const consoleStructuredLogger: StructuredLogSink = {
  info(entry) {
    console.info(JSON.stringify(redactSensitive(entry)));
  },
  error(entry) {
    console.error(JSON.stringify(redactSensitive(entry)));
  },
};

const incomingRequestId = (request: FastifyRequest): string | null => {
  const value = request.headers['x-request-id'];
  if (typeof value !== 'string' || !REQUEST_ID.test(value)) return null;
  return value;
};

const safePath = (request: FastifyRequest): string => request.url.split('?', 1)[0] || '/';

export const installHttpObservability = (
  app: FastifyInstance,
  options: HttpObservabilityOptions = {},
): void => {
  const logger = options.logger ?? consoleStructuredLogger;
  const nowMs = options.nowMs ?? Date.now;
  const requestId = options.requestId ?? randomUUID;
  const requests = new WeakMap<FastifyRequest, { id: string; startedAtMs: number }>();

  app.addHook('onRequest', async (request, reply) => {
    const id = incomingRequestId(request) ?? requestId();
    requests.set(request, { id, startedAtMs: nowMs() });
    void reply.header('x-request-id', id);
    logger.info({
      event: 'http.request.started',
      request_id: id,
      method: request.method,
      path: safePath(request),
    });
  });

  app.addHook('onResponse', async (request, reply) => {
    const state = requests.get(request);
    if (!state) return;
    logger.info({
      event: 'http.request.completed',
      request_id: state.id,
      method: request.method,
      path: safePath(request),
      status_code: reply.statusCode,
      duration_ms: Math.max(0, nowMs() - state.startedAtMs),
    });
  });

  app.addHook('onError', async (request, reply, error) => {
    const state = requests.get(request);
    logger.error({
      event: 'http.request.failed',
      request_id: state?.id ?? 'unavailable',
      method: request.method,
      path: safePath(request),
      status_code: reply.statusCode,
      error_name: error.name,
    });
  });

  app.get('/health/live', async (_request, reply) => reply.code(200).send({ ok: true }));

  app.get('/health/ready', async (_request, reply) => {
    if (!options.readiness) return reply.code(200).send({ ok: true });
    try {
      const ready = await options.readiness();
      return reply.code(ready ? 200 : 503).send({ ok: ready });
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
};
