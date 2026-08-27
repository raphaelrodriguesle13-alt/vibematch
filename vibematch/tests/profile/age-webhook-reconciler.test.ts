import { jest } from '@jest/globals';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { AgeWebhookReconciler } from '../../backend/src/profile/age-webhook-reconciler';
import type { AgeAssuranceProvider } from '../../backend/src/shared/providers';

type SessionRow = { user_id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' };
type StatusRow = { status: 'PENDING' | 'APPROVED' | 'REJECTED' };

const result = <T extends object>(rows: T[]): QueryResult<T> =>
  ({ rows, rowCount: rows.length, command: '', oid: 0, fields: [] }) as QueryResult<T>;

const providerFor = (decision: 'PENDING' | 'APPROVED' | 'REJECTED'): AgeAssuranceProvider => ({
  start: async () => ({ sessionRef: 'provider-session', verificationUrl: 'https://verify.example' }),
  getResult: jest.fn(async () => ({ decision, providerTransactionId: 'provider-session' })),
  verifyWebhookSignature: () => true,
});

const poolFor = (
  session: SessionRow | null,
  updatedStatus: StatusRow | null,
): { pool: Pool; clientQuery: ReturnType<typeof jest.fn> } => {
  const clientQuery = jest.fn(async (sql: string) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return result([]);
    if (sql.includes('UPDATE age_assurance_sessions')) {
      return result(updatedStatus ? [updatedStatus] : []);
    }
    if (sql.includes('UPDATE users')) return result([]);
    return result([]);
  });
  const client = {
    query: clientQuery,
    release: jest.fn(),
  } as unknown as PoolClient;
  const pool = {
    query: jest.fn(async () => result(session ? [session] : [])),
    connect: jest.fn(async () => client),
  } as unknown as Pool;
  return { pool, clientQuery };
};

describe('AgeWebhookReconciler', () => {
  it('does not call the provider for an unknown provider session', async () => {
    const provider = providerFor('APPROVED');
    const { pool } = poolFor(null, null);
    const reconciler = new AgeWebhookReconciler(pool, provider);

    await expect(reconciler.reconcileProviderSession('unknown')).resolves.toEqual({
      outcome: 'SESSION_NOT_FOUND',
    });
    expect(provider.getResult).not.toHaveBeenCalled();
  });

  it('is idempotent for a duplicate terminal provider decision', async () => {
    const { pool } = poolFor(
      { user_id: 'user-1', status: 'APPROVED' },
      { status: 'APPROVED' },
    );
    const reconciler = new AgeWebhookReconciler(pool, providerFor('APPROVED'));

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
    const reconciler = new AgeWebhookReconciler(pool, providerFor('REJECTED'));

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
    const reconciler = new AgeWebhookReconciler(pool, providerFor('APPROVED'));

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
