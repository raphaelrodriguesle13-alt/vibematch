import { jest } from '@jest/globals';

import {
  BillingError,
  BillingService,
  type AppliedRtdnResult,
  type BillingRepositoryPort,
  type BillingStatus,
  type SubscriptionEntitlement,
  type VerifiedPlaySubscription,
} from '../../backend/src/billing/service';

const userId = '11111111-1111-4111-8111-111111111111';

class FakeBillingRepository implements BillingRepositoryPort {
  active = true;
  ownerByToken = new Map<string, string>();
  events = new Set<string>();
  stored: SubscriptionEntitlement | null = null;

  isUserActive(): Promise<boolean> {
    return Promise.resolve(this.active);
  }

  findLatestEntitlementForUser(userId: string): Promise<SubscriptionEntitlement | null> {
    if (!this.stored || this.stored.userId !== userId) return Promise.resolve(null);
    return Promise.resolve(this.stored);
  }

  upsertVerifiedSubscription(input: {
    userId: string;
    purchaseToken: string;
    plan: string;
    status: BillingStatus;
    currentPeriodEnd: Date;
    now: Date;
  }): Promise<SubscriptionEntitlement | null> {
    const existingOwner = this.ownerByToken.get(input.purchaseToken);
    if (existingOwner && existingOwner !== input.userId) return Promise.resolve(null);
    this.ownerByToken.set(input.purchaseToken, input.userId);
    this.stored = {
      userId: input.userId,
      plan: input.plan,
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd,
      entitled: false,
    };
    return Promise.resolve(this.stored);
  }

  findUserIdByPurchaseToken(purchaseToken: string): Promise<string | null> {
    return Promise.resolve(this.ownerByToken.get(purchaseToken) ?? null);
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
    if (this.events.has(input.notificationId)) {
      return { duplicate: true, entitlement: null, accountActive: false };
    }

    const existingOwner = this.ownerByToken.get(input.purchaseToken);
    if (existingOwner && existingOwner !== input.userId) {
      return { duplicate: false, entitlement: null, accountActive: this.active };
    }

    const next: SubscriptionEntitlement = {
      userId: input.userId,
      plan: input.plan,
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd,
      entitled: false,
    };
    this.events.add(input.notificationId);
    this.ownerByToken.set(input.purchaseToken, input.userId);
    this.stored = next;
    return { duplicate: false, entitlement: next, accountActive: this.active };
  }
}

describe('BillingService', () => {
  it('grants entitlement only after server-side Play verification', async () => {
    const repository = new FakeBillingRepository();
    const verifier = {
      verifySubscription: jest.fn(() =>
        Promise.resolve<VerifiedPlaySubscription>({
          purchaseToken: 'purchase-1',
          productId: 'premium_monthly',
          status: 'ACTIVE',
          currentPeriodEnd: new Date('2026-09-26T00:00:00.000Z'),
        }),
      ),
    };
    const service = new BillingService(
      repository,
      verifier,
      () => new Date('2026-08-26T00:00:00.000Z'),
    );

    const result = await service.verifyPurchase(userId, 'purchase-1');

    expect(verifier.verifySubscription).toHaveBeenCalledWith('purchase-1');
    expect(result).toMatchObject({
      userId,
      plan: 'premium_monthly',
      status: 'ACTIVE',
      entitled: true,
    });
  });

  it('does not grant an expired subscription even when Google confirms the token', async () => {
    const repository = new FakeBillingRepository();
    const service = new BillingService(
      repository,
      {
        verifySubscription: () =>
          Promise.resolve({
            purchaseToken: 'expired',
            productId: 'premium_monthly',
            status: 'EXPIRED',
            currentPeriodEnd: new Date('2026-08-25T00:00:00.000Z'),
          }),
      },
      () => new Date('2026-08-26T00:00:00.000Z'),
    );

    await expect(service.verifyPurchase(userId, 'expired')).resolves.toMatchObject({
      status: 'EXPIRED',
      entitled: false,
    });
  });

  it('rejects purchase-token reassignment across accounts', async () => {
    const repository = new FakeBillingRepository();
    repository.ownerByToken.set('shared-token', '22222222-2222-4222-8222-222222222222');
    const service = new BillingService(repository, {
      verifySubscription: () =>
        Promise.resolve({
          purchaseToken: 'shared-token',
          productId: 'premium_monthly',
          status: 'ACTIVE',
          currentPeriodEnd: new Date('2026-09-26T00:00:00.000Z'),
        }),
    });

    await expect(service.verifyPurchase(userId, 'shared-token')).rejects.toMatchObject({
      code: 'PURCHASE_NOT_OWNED',
    } satisfies Partial<BillingError>);
  });

  it('revalidates RTDN against Google and atomically deduplicates notification ids', async () => {
    const repository = new FakeBillingRepository();
    repository.ownerByToken.set('purchase-1', userId);
    const verifier = {
      verifySubscription: jest.fn(() =>
        Promise.resolve<VerifiedPlaySubscription>({
          purchaseToken: 'purchase-1',
          productId: 'premium_monthly',
          status: 'REVOKED',
          currentPeriodEnd: new Date('2026-09-26T00:00:00.000Z'),
        }),
      ),
    };
    const service = new BillingService(repository, verifier);
    const input = {
      notificationId: 'notification-1',
      purchaseToken: 'purchase-1',
      notificationType: 'SUBSCRIPTION_REVOKED',
      eventTime: new Date('2026-08-26T00:00:00.000Z'),
    };

    const first = await service.processRtdn(input);
    const second = await service.processRtdn(input);

    expect(first.entitlement).toMatchObject({ status: 'REVOKED', entitled: false });
    expect(second).toEqual({ duplicate: true, entitlement: null });
    expect(verifier.verifySubscription).toHaveBeenCalledTimes(2);
    expect(repository.events).toEqual(new Set(['notification-1']));
  });

  it('rejects an RTDN when Google returns a different purchase token', async () => {
    const repository = new FakeBillingRepository();
    repository.ownerByToken.set('purchase-1', userId);
    const service = new BillingService(repository, {
      verifySubscription: () =>
        Promise.resolve({
          purchaseToken: 'different-token',
          productId: 'premium_monthly',
          status: 'ACTIVE',
          currentPeriodEnd: new Date('2026-09-26T00:00:00.000Z'),
        }),
    });

    await expect(
      service.processRtdn({
        notificationId: 'notification-mismatch',
        purchaseToken: 'purchase-1',
        notificationType: 'SUBSCRIPTION_RECOVERED',
        eventTime: new Date('2026-08-26T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'PLAY_VERIFICATION_FAILED' } satisfies Partial<BillingError>);

    expect(repository.events.size).toBe(0);
    expect(repository.stored).toBeNull();
  });

  it('keeps RTDN accounting synchronized but never grants premium to a restricted account', async () => {
    const repository = new FakeBillingRepository();
    repository.ownerByToken.set('restricted-purchase', userId);
    repository.active = false;
    const service = new BillingService(
      repository,
      {
        verifySubscription: () =>
          Promise.resolve({
            purchaseToken: 'restricted-purchase',
            productId: 'premium_monthly',
            status: 'ACTIVE',
            currentPeriodEnd: new Date('2026-09-26T00:00:00.000Z'),
          }),
      },
      () => new Date('2026-08-26T00:00:00.000Z'),
    );

    const result = await service.processRtdn({
      notificationId: 'restricted-notification',
      purchaseToken: 'restricted-purchase',
      notificationType: 'SUBSCRIPTION_RECOVERED',
      eventTime: new Date('2026-08-26T00:00:00.000Z'),
    });

    expect(repository.stored).toMatchObject({ status: 'ACTIVE' });
    expect(result.entitlement).toMatchObject({
      userId,
      status: 'ACTIVE',
      entitled: false,
    });
  });

  it('fails closed when Google Play verification is unavailable', async () => {
    const repository = new FakeBillingRepository();
    const service = new BillingService(repository, {
      verifySubscription: () => Promise.reject(new Error('provider down')),
    });

    await expect(service.verifyPurchase(userId, 'purchase-1')).rejects.toMatchObject({
      code: 'PLAY_VERIFICATION_FAILED',
    } satisfies Partial<BillingError>);
  });
});
