import { jest } from '@jest/globals';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { AgeWebhookReconciler } from '../../backend/src/profile/age-webhook-reconciler';
import type { AgeAssuranceProvider } from '../../backend/src/shared/providers';

type SessionRow = { user_id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' };
type StatusRow = { status: 'PENDING' | 'APPROVED' | 'REJECTED' };

const result = <T extends object>(rows: T[]): QueryResult<T> => ({
  rows,
  rowCount: rows.length,
  command: '',
  oid: 0,
  fields: [],
});

const providerFor = (
  decision: 'PENDING' | 'APPROVED' | 'REJECTED',
): { provider: AgeAssuranceProvider; getResult: ReturnType<typeof jest.fn> } => {
  const getResult = jest.fn(() =>
    Promise.resolve({ decision, providerTransactionId: 'provider-session' }),
  );
  return {
    getResult,
    provider: {
      start: () =>
        Promise.resolve({
          sessionRef: 'provider-session',
          verificationUrl: 'https://verify.example',
        }),
      getResult,
      verifyWebhookSignature: () => true,
    },
  };
};

const poolFor = (
  session: SessionRow | null,
  updatedStatus: StatusRow | null,
): { pool: Pool; clientQuery: ReturnType<typeof jest.fn> } => {
  const clientQuery = jest.fn((sql: string) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve(result([]));
    if (sql.includes('UPDATE age_assurance_sessions')) {
      return Promise.resolve(result(updatedStatus ? [updatedStatus] : []));
    }
    return Promise.resolve(result([]));
  });
  const client = {
    query: clientQuery,
    release: jest.fn(),
  } as unknown as PoolClient;
  const pool = {
    query: jest.fn(() => Promise.resolve(result(session ? [session] : []))),
    connect: jest.fn(() => Promise.resolve(client)),
  } as unknown as Pool;
  return { pool, clientQuery };
};

describe('AgeWebhookReconciler', () => {
  it('does not call the provider for an unknown provider session', async () => {
    const { provider, getResult } = providerFor('APPROVED');
    const { pool } = poolFor(null, null);
    const reconciler = new AgeWebhookReconciler(pool, provider);

    await expect(reconciler.reconcileProviderSession('unknown')).resolves.toEqual({
      outcome: 'SESSION_NOT_FOUND',
    });
    expect(getResult).not.toHaveBeenCalled();
  });

  it('is idempotent for a duplicate terminal provider decision', async () => {
    const { pool } = poolFor(
      { user_id: 'user-1', status: 'APPROVED' },
      { status: 'APPROVED' },
    );
    const { provider } = providerFor('APPROVED');
    const reconciler = new AgeWebhookReconciler(pool, provider);

    await expect(reconciler.reconcileProviderSession('provider-session')).resolves.toEqual({
      outcome: 'DUPLICATE_OR_STALE',
      status: 'APPROVED',
    });
  });

  it('fails closed by applying an approved-to-rejected provider revocation', async () => {
    const { pool, clientQuery } = poolFor(
      { user_id: 'user-1', status: 'APPROVED' },
      { status: 'REJECTED' },
    );
    const { provider } = providerFor('REJECTED');
    const reconciler = new AgeWebhookReconciler(pool, provider);

    await expect(reconciler.reconcileProviderSession('provider-session')).resolves.toEqual({
      outcome: 'APPLIED',
      status: 'REJECTED',
    });
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      expect.arrayContaining(['user-1', 'REJECTED']),
    );
  });

  it('does not resurrect a rejected session from a stale approved decision', async () => {
    const { pool, clientQuery } = poolFor({ user_id: 'user-1', status: 'REJECTED' }, null);
    const { provider } = providerFor('APPROVED');
    const reconciler = new AgeWebhookReconciler(pool, provider);

    await expect(reconciler.reconcileProviderSession('provider-session')).resolves.toEqual({
      outcome: 'DUPLICATE_OR_STALE',
      status: 'REJECTED',
    });
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(clientQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      expect.anything(),
    );
  });
});
