import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type {
  AppliedRtdnResult,
  BillingRepositoryPort,
  BillingStatus,
  SubscriptionEntitlement,
} from './service';

interface SubscriptionRow extends QueryResultRow {
  user_id: string;
  plan: string;
  status: BillingStatus;
  current_period_end: Date;
}

const toEntitlement = (row: SubscriptionRow): SubscriptionEntitlement => ({
  userId: row.user_id,
  plan: row.plan,
  status: row.status,
  currentPeriodEnd: new Date(row.current_period_end),
  entitled: false,
});

const upsertSubscription = async (
  client: Pick<PoolClient, 'query'>,
  input: {
    userId: string;
    purchaseToken: string;
    plan: string;
    status: BillingStatus;
    currentPeriodEnd: Date;
    now: Date;
  },
): Promise<SubscriptionEntitlement | null> => {
  const result = await client.query<SubscriptionRow>(
    `INSERT INTO subscriptions (
       user_id, play_purchase_token, plan, status, current_period_end, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (play_purchase_token) DO UPDATE
     SET plan = EXCLUDED.plan,
         status = EXCLUDED.status,
         current_period_end = EXCLUDED.current_period_end,
         updated_at = EXCLUDED.updated_at
     WHERE subscriptions.user_id = EXCLUDED.user_id
     RETURNING user_id, plan, status, current_period_end`,
    [
      input.userId,
      input.purchaseToken,
      input.plan,
      input.status,
      input.currentPeriodEnd,
      input.now,
    ],
  );
  const row = result.rows[0];
  return row ? toEntitlement(row) : null;
};

export class BillingRepository implements BillingRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async isUserActive(userId: string): Promise<boolean> {
    const result = await this.pool.query<{ active: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM users WHERE id = $1 AND status = 'ACTIVE'
       ) AS active`,
      [userId],
    );
    return result.rows[0]?.active === true;
  }

  async upsertVerifiedSubscription(input: {
    userId: string;
    purchaseToken: string;
    plan: string;
    status: BillingStatus;
    currentPeriodEnd: Date;
    now: Date;
  }): Promise<SubscriptionEntitlement | null> {
    return upsertSubscription(this.pool, input);
  }

  async findLatestEntitlementForUser(userId: string): Promise<SubscriptionEntitlement | null> {
    const result = await this.pool.query<SubscriptionRow>(
      `SELECT user_id, plan, status, current_period_end
       FROM subscriptions
       WHERE user_id = $1
       ORDER BY current_period_end DESC, updated_at DESC
       LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    return row ? toEntitlement(row) : null;
  }

  async findUserIdByPurchaseToken(purchaseToken: string): Promise<string | null> {
    const result = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM subscriptions WHERE play_purchase_token = $1`,
      [purchaseToken],
    );
    return result.rows[0]?.user_id ?? null;
  }

  async applyVerifiedRtdn(input: {
    userId: string;
    notificationId: string;
    purchaseToken: string;
    notificationType: string;
    eventTime: Date;
    plan: string;
    status: BillingStatus;
    currentPeriodEnd: Date;
    now: Date;
  }): Promise<AppliedRtdnResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const event = await client.query<{ id: string }>(
        `INSERT INTO billing_events (
           notification_id, purchase_token, notification_type, event_time
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (notification_id) DO NOTHING
         RETURNING id`,
        [input.notificationId, input.purchaseToken, input.notificationType, input.eventTime],
      );
      if (event.rowCount !== 1) {
        await client.query('COMMIT');
        return { duplicate: true, entitlement: null, accountActive: false };
      }

      const account = await client.query<{ status: string }>(
        `SELECT status
         FROM users
         WHERE id = $1
         FOR SHARE`,
        [input.userId],
      );
      const accountStatus = account.rows[0]?.status;
      if (!accountStatus) {
        await client.query('ROLLBACK');
        return { duplicate: false, entitlement: null, accountActive: false };
      }

      const entitlement = await upsertSubscription(client, input);
      if (!entitlement) {
        await client.query('ROLLBACK');
        return { duplicate: false, entitlement: null, accountActive: accountStatus === 'ACTIVE' };
      }

      await client.query('COMMIT');
      return {
        duplicate: false,
        entitlement,
        accountActive: accountStatus === 'ACTIVE',
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
