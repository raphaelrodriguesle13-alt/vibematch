import type { Pool, QueryResultRow } from 'pg';
import type { BillingRepositoryPort, BillingStatus, SubscriptionEntitlement } from './service';

interface SubscriptionRow extends QueryResultRow {
  user_id: string;
  plan: string;
  status: BillingStatus;
  current_period_end: Date;
}

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
    const result = await this.pool.query<SubscriptionRow>(
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
    if (!row) return null;
    return {
      userId: row.user_id,
      plan: row.plan,
      status: row.status,
      currentPeriodEnd: new Date(row.current_period_end),
      entitled: false,
    };
  }

  async findUserIdByPurchaseToken(purchaseToken: string): Promise<string | null> {
    const result = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM subscriptions WHERE play_purchase_token = $1`,
      [purchaseToken],
    );
    return result.rows[0]?.user_id ?? null;
  }

  async recordBillingEvent(input: {
    notificationId: string;
    purchaseToken: string;
    notificationType: string;
    eventTime: Date;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO billing_events (
         notification_id, purchase_token, notification_type, event_time
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (notification_id) DO NOTHING`,
      [input.notificationId, input.purchaseToken, input.notificationType, input.eventTime],
    );
    return result.rowCount === 1;
  }
}
