import { randomUUID } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import { BillingRepository } from '../../../backend/src/billing/repository';
import { closeAll, ownerPool } from '../../helpers/db';

afterAll(closeAll);

type IdRow = { id: string } & QueryResultRow;

const first = <T extends QueryResultRow>(result: QueryResult<T>): T => {
  const row = result.rows[0];
  if (!row) throw new Error('Expected database row');
  return row;
};

const createUser = async (): Promise<string> => {
  const result = await ownerPool.query<IdRow>(
    `INSERT INTO users (google_subject_id)
     VALUES ($1)
     RETURNING id`,
    [`billing-atomic-${randomUUID()}`],
  );
  return first(result).id;
};

describe('Billing persistence safety', () => {
  test('ownership failure rolls back the billing event so a retry is not poisoned', async () => {
    const ownerId = await createUser();
    const otherUserId = await createUser();
    const purchaseToken = `purchase-${randomUUID()}`;
    const notificationId = `notification-${randomUUID()}`;
    const repository = new BillingRepository(ownerPool);

    try {
      await ownerPool.query(
        `INSERT INTO subscriptions
           (user_id, play_purchase_token, plan, status, current_period_end)
         VALUES ($1, $2, 'premium_monthly', 'ACTIVE', now() + interval '30 days')`,
        [ownerId, purchaseToken],
      );

      const failed = await repository.applyVerifiedRtdn({
        userId: otherUserId,
        notificationId,
        purchaseToken,
        notificationType: 'SUBSCRIPTION_REVOKED',
        eventTime: new Date('2026-08-27T00:00:00.000Z'),
        plan: 'premium_monthly',
        status: 'REVOKED',
        currentPeriodEnd: new Date('2026-09-27T00:00:00.000Z'),
        now: new Date('2026-08-27T00:00:01.000Z'),
      });

      expect(failed).toMatchObject({ duplicate: false, entitlement: null });

      const poisoned = await ownerPool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM billing_events WHERE notification_id = $1',
        [notificationId],
      );
      expect(poisoned.rows[0]?.count).toBe('0');

      const retry = await repository.applyVerifiedRtdn({
        userId: ownerId,
        notificationId,
        purchaseToken,
        notificationType: 'SUBSCRIPTION_REVOKED',
        eventTime: new Date('2026-08-27T00:00:00.000Z'),
        plan: 'premium_monthly',
        status: 'REVOKED',
        currentPeriodEnd: new Date('2026-09-27T00:00:00.000Z'),
        now: new Date('2026-08-27T00:00:02.000Z'),
      });

      expect(retry.duplicate).toBe(false);
      expect(retry.entitlement).toMatchObject({ userId: ownerId, status: 'REVOKED' });

      const persisted = await ownerPool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM billing_events WHERE notification_id = $1',
        [notificationId],
      );
      expect(persisted.rows[0]?.count).toBe('1');
    } finally {
      await ownerPool.query('DELETE FROM billing_events WHERE notification_id = $1', [
        notificationId,
      ]);
      await ownerPool.query('DELETE FROM subscriptions WHERE play_purchase_token = $1', [
        purchaseToken,
      ]);
      await ownerPool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [ownerId, otherUserId],
      ]);
    }
  });

  test('account restriction wins a concurrent client purchase verification', async () => {
    const userId = await createUser();
    const purchaseToken = `purchase-race-${randomUUID()}`;
    const restrictClient = await ownerPool.connect();
    const repository = new BillingRepository(ownerPool);
    let committed = false;

    try {
      await restrictClient.query('BEGIN');
      await restrictClient.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [userId]);

      let settled = false;
      const purchasePromise = repository
        .upsertVerifiedSubscription({
          userId,
          purchaseToken,
          plan: 'premium_monthly',
          status: 'ACTIVE',
          currentPeriodEnd: new Date('2026-09-27T00:00:00.000Z'),
          now: new Date('2026-08-27T00:00:00.000Z'),
        })
        .finally(() => {
          settled = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(settled).toBe(false);

      await restrictClient.query('COMMIT');
      committed = true;
      await expect(purchasePromise).resolves.toBeNull();

      const subscriptions = await ownerPool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM subscriptions WHERE play_purchase_token = $1',
        [purchaseToken],
      );
      expect(subscriptions.rows[0]?.count).toBe('0');
    } finally {
      if (!committed) await restrictClient.query('ROLLBACK').catch(() => undefined);
      restrictClient.release();
      await ownerPool.query('DELETE FROM subscriptions WHERE play_purchase_token = $1', [
        purchaseToken,
      ]);
      await ownerPool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
  });
});
