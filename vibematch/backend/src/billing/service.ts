export type BillingStatus = 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'GRACE_PERIOD' | 'REVOKED';

export type VerifiedPlaySubscription = {
  purchaseToken: string;
  productId: string;
  status: BillingStatus;
  currentPeriodEnd: Date;
};

export type SubscriptionEntitlement = {
  userId: string;
  plan: string;
  status: BillingStatus;
  currentPeriodEnd: Date;
  entitled: boolean;
};

export interface GooglePlaySubscriptionVerifier {
  verifySubscription(purchaseToken: string): Promise<VerifiedPlaySubscription>;
}

export interface BillingRepositoryPort {
  isUserActive(userId: string): Promise<boolean>;
  upsertVerifiedSubscription(input: {
    userId: string;
    purchaseToken: string;
    plan: string;
    status: BillingStatus;
    currentPeriodEnd: Date;
    now: Date;
  }): Promise<SubscriptionEntitlement | null>;
  findLatestEntitlementForUser(userId: string): Promise<SubscriptionEntitlement | null>;
  findUserIdByPurchaseToken(purchaseToken: string): Promise<string | null>;
  recordBillingEvent(input: {
    notificationId: string;
    purchaseToken: string;
    notificationType: string;
    eventTime: Date;
  }): Promise<boolean>;
}

export type BillingErrorCode =
  | 'INVALID_BILLING_REQUEST'
  | 'ACCOUNT_UNAVAILABLE'
  | 'PURCHASE_NOT_OWNED'
  | 'PLAY_VERIFICATION_FAILED';

export class BillingError extends Error {
  constructor(
    readonly code: BillingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isEntitled = (status: BillingStatus, periodEnd: Date, now: Date): boolean =>
  (status === 'ACTIVE' || status === 'GRACE_PERIOD') && periodEnd.getTime() > now.getTime();

export class BillingService {
  constructor(
    private readonly repository: BillingRepositoryPort,
    private readonly verifier: GooglePlaySubscriptionVerifier,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getEntitlement(userId: string): Promise<SubscriptionEntitlement | null> {
    if (!UUID.test(userId)) {
      throw new BillingError('INVALID_BILLING_REQUEST', 'Billing request is invalid');
    }
    if (!(await this.repository.isUserActive(userId))) {
      throw new BillingError('ACCOUNT_UNAVAILABLE', 'Account is not eligible for billing');
    }

    const stored = await this.repository.findLatestEntitlementForUser(userId);
    if (!stored) return null;
    return {
      ...stored,
      entitled: isEntitled(stored.status, stored.currentPeriodEnd, this.now()),
    };
  }

  async verifyPurchase(userId: string, purchaseToken: string): Promise<SubscriptionEntitlement> {
    if (!UUID.test(userId) || !purchaseToken.trim()) {
      throw new BillingError('INVALID_BILLING_REQUEST', 'Billing request is invalid');
    }
    if (!(await this.repository.isUserActive(userId))) {
      throw new BillingError('ACCOUNT_UNAVAILABLE', 'Account is not eligible for billing');
    }

    let verified: VerifiedPlaySubscription;
    try {
      verified = await this.verifier.verifySubscription(purchaseToken.trim());
    } catch {
      throw new BillingError('PLAY_VERIFICATION_FAILED', 'Google Play verification failed');
    }

    if (verified.purchaseToken !== purchaseToken.trim()) {
      throw new BillingError('PLAY_VERIFICATION_FAILED', 'Verified token did not match request');
    }

    const now = this.now();
    const stored = await this.repository.upsertVerifiedSubscription({
      userId,
      purchaseToken: verified.purchaseToken,
      plan: verified.productId,
      status: verified.status,
      currentPeriodEnd: verified.currentPeriodEnd,
      now,
    });
    if (!stored) {
      throw new BillingError('PURCHASE_NOT_OWNED', 'Purchase token belongs to another account');
    }

    return {
      ...stored,
      entitled: isEntitled(stored.status, stored.currentPeriodEnd, now),
    };
  }

  async processRtdn(input: {
    notificationId: string;
    purchaseToken: string;
    notificationType: string;
    eventTime: Date;
  }): Promise<{ duplicate: boolean; entitlement: SubscriptionEntitlement | null }> {
    if (
      !input.notificationId.trim() ||
      !input.purchaseToken.trim() ||
      !input.notificationType.trim() ||
      Number.isNaN(input.eventTime.getTime())
    ) {
      throw new BillingError('INVALID_BILLING_REQUEST', 'RTDN payload is invalid');
    }

    const userId = await this.repository.findUserIdByPurchaseToken(input.purchaseToken.trim());
    if (!userId) {
      return { duplicate: false, entitlement: null };
    }

    let verified: VerifiedPlaySubscription;
    try {
      verified = await this.verifier.verifySubscription(input.purchaseToken.trim());
    } catch {
      throw new BillingError('PLAY_VERIFICATION_FAILED', 'Google Play verification failed');
    }

    const inserted = await this.repository.recordBillingEvent({
      notificationId: input.notificationId.trim(),
      purchaseToken: input.purchaseToken.trim(),
      notificationType: input.notificationType.trim(),
      eventTime: input.eventTime,
    });
    if (!inserted) {
      return { duplicate: true, entitlement: null };
    }

    const now = this.now();
    const stored = await this.repository.upsertVerifiedSubscription({
      userId,
      purchaseToken: verified.purchaseToken,
      plan: verified.productId,
      status: verified.status,
      currentPeriodEnd: verified.currentPeriodEnd,
      now,
    });
    if (!stored) {
      throw new BillingError('PURCHASE_NOT_OWNED', 'Purchase ownership changed unexpectedly');
    }

    return {
      duplicate: false,
      entitlement: {
        ...stored,
        entitled: isEntitled(stored.status, stored.currentPeriodEnd, now),
      },
    };
  }
}
