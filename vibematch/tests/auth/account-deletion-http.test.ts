import fastify from 'fastify';
import { registerAccountDeletionRoute } from '../../backend/src/account/http';
import { AccountDeletionError } from '../../backend/src/account/service';
import type { AuthSession } from '../../backend/src/auth/repository';

const now = new Date('2026-08-28T22:00:00.000Z');
const activeSession: AuthSession = {
  id: 'session-a',
  userId: 'user-a',
  expiresAt: new Date('2026-08-28T23:00:00.000Z'),
  revokedAt: null,
};

const build = (overrides?: {
  activeSession?: AuthSession | null;
  requestDeletion?: () => Promise<'PENDING_DELETION' | 'DELETED'>;
}) => {
  const app = fastify({ logger: false });
  const requestDeletion = jest.fn(
    overrides?.requestDeletion ?? (() => Promise.resolve<'PENDING_DELETION'>('PENDING_DELETION')),
  );
  const touchSession = jest.fn(() => Promise.resolve());
  const session =
    overrides && Object.prototype.hasOwnProperty.call(overrides, 'activeSession')
      ? (overrides.activeSession ?? null)
      : activeSession;

  registerAccountDeletionRoute(app, {
    service: { requestDeletion },
    sessionTokenVerifier: {
      verify: jest.fn(() =>
        Promise.resolve({ userId: 'user-a', sessionId: 'session-a', phoneVerified: true }),
      ),
    },
    activeSessionStore: {
      findActiveSession: jest.fn(() => Promise.resolve(session)),
      touchSession,
    },
    now: () => now,
  });

  return { app, requestDeletion, touchSession };
};

describe('DELETE /api/account', () => {
  test('requires an active authenticated session', async () => {
    const { app, requestDeletion } = build();
    const response = await app.inject({ method: 'DELETE', url: '/api/account' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'UNAUTHORIZED' });
    expect(requestDeletion).not.toHaveBeenCalled();
    await app.close();
  });

  test('requests deletion only for the authenticated user', async () => {
    const { app, requestDeletion, touchSession } = build();
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/account',
      headers: { authorization: 'Bearer session-token' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true, status: 'PENDING_DELETION' });
    expect(requestDeletion).toHaveBeenCalledTimes(1);
    expect(requestDeletion).toHaveBeenCalledWith('user-a');
    expect(touchSession).toHaveBeenCalledTimes(1);
    await app.close();
  });

  test('fails closed when deletion authority is unavailable', async () => {
    const { app } = build({
      requestDeletion: () =>
        Promise.reject(
          new AccountDeletionError('ACCOUNT_DELETION_UNAVAILABLE', 'storage unavailable'),
        ),
    });
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/account',
      headers: { authorization: 'Bearer session-token' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'ACCOUNT_DELETION_UNAVAILABLE' });
    await app.close();
  });

  test('does not call deletion authority for a revoked session', async () => {
    const { app, requestDeletion } = build({ activeSession: null });
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/account',
      headers: { authorization: 'Bearer session-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'SESSION_REVOKED_OR_EXPIRED' });
    expect(requestDeletion).not.toHaveBeenCalled();
    await app.close();
  });
});
