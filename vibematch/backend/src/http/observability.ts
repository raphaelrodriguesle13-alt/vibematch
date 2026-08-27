import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface StructuredLogSink {
  info(entry: Readonly<Record<string, unknown>>): void;
  error(entry: Readonly<Record<string, unknown>>): void;
}

export interface HttpObservabilityOptions {
  logger?: StructuredLogSink;
  readiness?: () => Promise<boolean>;
  readinessTimeoutMs?: number;
  nowMs?: () => number;
  requestId?: () => string;
}

const SENSITIVE_KEY =
  /authorization|cookie|token|jwt|password|secret|private.?key|api.?key|auth.?token|phone|otp|verification.?code|sms.?code|code.?verifier/i;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const DEFAULT_READINESS_TIMEOUT_MS = 2_000;
const CREDENTIAL_RESPONSE_PATHS = new Set(['/auth/google', '/auth/refresh']);

export const redactSensitive = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value === null || typeof value !== 'object') return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(child);
  }
  return redacted;
};

const writeStructured = (
  stream: NodeJS.WriteStream,
  entry: Readonly<Record<string, unknown>>,
): void => {
  stream.write(`${JSON.stringify(redactSensitive(entry))}\n`);
};

export const consoleStructuredLogger: StructuredLogSink = {
  info(entry) {
    writeStructured(process.stdout, entry);
  },
  error(entry) {
    writeStructured(process.stderr, entry);
  },
};

const incomingRequestId = (request: FastifyRequest): string | null => {
  const value = request.headers['x-request-id'];
  if (typeof value !== 'string' || !REQUEST_ID.test(value)) return null;
  return value;
};

const safePath = (request: FastifyRequest): string => request.url.split('?', 1)[0] || '/';

const safeErrorStatus = (error: unknown): number => {
  const candidate =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
  return typeof candidate === 'number' && candidate >= 400 && candidate < 500 ? candidate : 500;
};

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Timeout must be a positive finite number');
  }

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Operation timed out')), timeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const installHttpObservability = (
  app: FastifyInstance,
  options: HttpObservabilityOptions = {},
): void => {
  const logger = options.logger ?? consoleStructuredLogger;
  const nowMs = options.nowMs ?? Date.now;
  const requestId = options.requestId ?? randomUUID;
  const readinessTimeoutMs = options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
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

  app.addHook('onSend', async (request, reply, payload) => {
    if (CREDENTIAL_RESPONSE_PATHS.has(safePath(request))) {
      void reply.header('cache-control', 'no-store');
      void reply.header('pragma', 'no-cache');
    }
    return payload;
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
      status_code: safeErrorStatus(error),
      error_name: error.name,
    });
  });

  app.setErrorHandler(async (error, _request, reply) => {
    const statusCode = safeErrorStatus(error);
    return reply
      .code(statusCode)
      .send({ error: statusCode >= 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST' });
  });

  app.get('/health/live', async (_request, reply) => reply.code(200).send({ ok: true }));

  app.get('/health/ready', async (_request, reply) => {
    if (!options.readiness) return reply.code(200).send({ ok: true });
    try {
      const ready = await withTimeout(options.readiness(), readinessTimeoutMs);
      return reply.code(ready ? 200 : 503).send({ ok: ready });
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
};
