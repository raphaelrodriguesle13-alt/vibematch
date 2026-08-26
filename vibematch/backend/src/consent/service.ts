export type ConsentDecision = 'ACCEPTED' | 'DECLINED';
export type ConsentStatus = 'PENDING' | 'ACCEPTED_BOTH' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';

export type Consent = {
  id: string;
  matchIntentId: string;
  userAId: string;
  userBId: string;
  userAStatus: 'PENDING' | ConsentDecision;
  userBStatus: 'PENDING' | ConsentDecision;
  status: ConsentStatus;
  expiresAt: Date;
  videoDeadline: Date | null;
  acceptedBothAt: Date | null;
};

export interface ConsentRepositoryPort {
  createEligible(userId: string, matchIntentId: string, expiresAt: Date): Promise<Consent | null>;
  consumeDecisionRateLimit(userId: string, now: Date, limit: number): Promise<boolean>;
  decide(
    actingUserId: string,
    consentId: string,
    decision: ConsentDecision,
    authSessionRef: string,
    requestId: string,
    now: Date,
    videoDeadline: Date,
  ): Promise<Consent | null>;
}

export type ConsentErrorCode =
  'INVALID_CONSENT' | 'CONSENT_NOT_ELIGIBLE' | 'CONSENT_NOT_AVAILABLE' | 'RATE_LIMITED';

export class ConsentError extends Error {
  constructor(
    readonly code: ConsentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ConsentError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ConsentService {
  constructor(
    private readonly repository: ConsentRepositoryPort,
    private readonly now: () => Date = () => new Date(),
    private readonly consentTtlMs = 10 * 60 * 1000,
    private readonly videoWindowMs = 5 * 60 * 1000,
    private readonly decisionRateLimit = 30,
  ) {}

  async create(userId: string, matchIntentId: string): Promise<Consent> {
    if (!UUID.test(matchIntentId)) {
      throw new ConsentError('INVALID_CONSENT', 'Match intent is invalid');
    }
    const expiresAt = new Date(this.now().getTime() + this.consentTtlMs);
    const consent = await this.repository.createEligible(userId, matchIntentId, expiresAt);
    if (!consent) {
      throw new ConsentError('CONSENT_NOT_ELIGIBLE', 'Consent cannot be created');
    }
    return consent;
  }

  async decide(
    actingUserId: string,
    consentId: string,
    decision: ConsentDecision,
    authSessionRef: string,
    requestId: string,
  ): Promise<Consent> {
    if (!UUID.test(consentId) || !UUID.test(requestId) || authSessionRef.trim() === '') {
      throw new ConsentError('INVALID_CONSENT', 'Consent decision metadata is invalid');
    }
    const now = this.now();
    if (
      !(await this.repository.consumeDecisionRateLimit(actingUserId, now, this.decisionRateLimit))
    ) {
      throw new ConsentError('RATE_LIMITED', 'Consent decision rate limit exceeded');
    }

    const videoDeadline = new Date(now.getTime() + this.videoWindowMs);
    const consent = await this.repository.decide(
      actingUserId,
      consentId,
      decision,
      authSessionRef,
      requestId,
      now,
      videoDeadline,
    );
    if (!consent) {
      throw new ConsentError('CONSENT_NOT_AVAILABLE', 'Consent is unavailable');
    }
    return consent;
  }
}
