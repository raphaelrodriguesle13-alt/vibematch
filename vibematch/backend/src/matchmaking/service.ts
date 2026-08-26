export type MatchIntentStatus = 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';
export type MatchIntentDecision = 'ACCEPTED' | 'DECLINED';

export type MatchIntent = {
  id: string;
  senderId: string;
  receiverId: string;
  status: MatchIntentStatus;
  expiresAt: Date;
  respondedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
};

export interface MatchIntentRepositoryPort {
  createEligible(
    senderId: string,
    receiverId: string,
    expiresAt: Date,
  ): Promise<MatchIntent | null>;
  listIncoming(receiverId: string, now: Date): Promise<MatchIntent[]>;
  respond(
    receiverId: string,
    intentId: string,
    decision: MatchIntentDecision,
    now: Date,
  ): Promise<MatchIntent | null>;
}

export type MatchIntentErrorCode = 'INVALID_TARGET' | 'NOT_ELIGIBLE' | 'INTENT_NOT_AVAILABLE';

export class MatchIntentError extends Error {
  constructor(
    readonly code: MatchIntentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MatchIntentError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MatchIntentService {
  constructor(
    private readonly repository: MatchIntentRepositoryPort,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 10 * 60 * 1000,
  ) {}

  async create(senderId: string, receiverId: string): Promise<MatchIntent> {
    if (!UUID.test(receiverId) || senderId === receiverId) {
      throw new MatchIntentError('INVALID_TARGET', 'Match target is invalid');
    }
    const expiresAt = new Date(this.now().getTime() + this.ttlMs);
    const intent = await this.repository.createEligible(senderId, receiverId, expiresAt);
    if (!intent) {
      throw new MatchIntentError('NOT_ELIGIBLE', 'Match intent cannot be created');
    }
    return intent;
  }

  listIncoming(receiverId: string): Promise<MatchIntent[]> {
    return this.repository.listIncoming(receiverId, this.now());
  }

  async respond(
    receiverId: string,
    intentId: string,
    decision: MatchIntentDecision,
  ): Promise<MatchIntent> {
    if (!UUID.test(intentId)) {
      throw new MatchIntentError('INTENT_NOT_AVAILABLE', 'Match intent is unavailable');
    }
    const intent = await this.repository.respond(receiverId, intentId, decision, this.now());
    if (!intent) {
      throw new MatchIntentError('INTENT_NOT_AVAILABLE', 'Match intent is unavailable');
    }
    return intent;
  }
}
