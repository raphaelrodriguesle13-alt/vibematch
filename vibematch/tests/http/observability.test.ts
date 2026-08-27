import fastify from 'fastify';
import {
  installHttpObservability,
  redactSensitive,
  type StructuredLogSink,
} from '../../backend/src/http/observability';

const makeSink = (): {
  sink: StructuredLogSink;
  info: Array<Readonly<Record<string, unknown>>>;
  error: Array<Readonly<Record<string, unknown>>>;
} => {
  const info: Array<Readonly<Record<string, unknown>>> = [];
  const error: Array<Readonly<Record<string, unknown>>> = [];
  return {
    info,
    error,
    sink: {
      info: (entry) => info.push(entry),
      error: (entry) => error.push(entry),
    },
  };
};

describe('HTTP observability', () => {
  test('redacts sensitive values recursively without mutating safe fields', () => {
    expect(
      redactSensitive({
        authorization: 'Bearer secret',
        nested: {
          phone_e164: '+5511999999999',
          apiKey: 'provider-secret',
          safe: 'visible',
        },
        list: [{ session_jwt: 'jwt-value', request_id: 'req-1' }],
      }),
    ).toEqual({
      authorization: '[REDACTED]',
      nested: {
        phone_e164: '[REDACTED]',
        apiKey: '[REDACTED]',
        safe: 'visible',
      },
      list: [{ session_jwt: '[REDACTED]', request_id: 'req-1' }],
    });
  });

  test('hooks routes registered before installation and echoes a safe request id', async () => {
    const app = fastify({ logger: false });
    const logs = makeSink();
    let clock = 1000;
    app.get('/existing?ignored=true', async () => ({ ok: true }));
    app.get('/existing', async () => ({ ok: true }));

    installHttpObservability(app, {
      logger: logs.sink,
      requestId: () => 'generated-1',
      nowMs: () => {
        clock += 7;
        return clock;
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/existing?access_token=must-not-be-logged',
      headers: { 'x-request-id': 'client-req_123' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('client-req_123');
    expect(logs.info).toContainEqual({
      event: 'http.request.started',
      request_id: 'client-req_123',
      method: 'GET',
      path: '/existing',
    });
    expect(logs.info).toContainEqual({
      event: 'http.request.completed',
      request_id: 'client-req_123',
      method: 'GET',
      path: '/existing',
      status_code: 200,
      duration_ms: 7,
    });
    expect(JSON.stringify(logs.info)).not.toContain('must-not-be-logged');
    await app.close();
  });

  test('rejects unsafe incoming request ids and generates a server id', async () => {
    const app = fastify({ logger: false });
    const logs = makeSink();
    app.get('/resource', async () => ({ ok: true }));
    installHttpObservability(app, { logger: logs.sink, requestId: () => 'server-generated' });

    const response = await app.inject({
      method: 'GET',
      url: '/resource',
      headers: { 'x-request-id': 'contains spaces and should be rejected' },
    });

    expect(response.headers['x-request-id']).toBe('server-generated');
    await app.close();
  });

  test('readiness fails closed without exposing dependency details', async () => {
    const app = fastify({ logger: false });
    const logs = makeSink();
    installHttpObservability(app, { logger: logs.sink, readiness: async () => false });

    const live = await app.inject({ method: 'GET', url: '/health/live' });
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ ok: true });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ ok: false });
    await app.close();
  });
});
