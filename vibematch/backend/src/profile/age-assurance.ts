import type { AgeAssuranceProvider } from '../shared/providers';

export type AgeAssuranceStatus = 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export type AgeAssuranceSession = {
  userId: string;
  providerSessionRef: string;
  verificationUrl: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
};

export type AgeAssuranceErrorCode =
  'ACCOUNT_UNAVAILABLE' | 'AGE_PROVIDER_UNAVAILABLE' | 'AGE_SESSION_NOT_AVAILABLE';

export class AgeAssuranceError extends Error {
  constructor(
    readonly code: AgeAssuranceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgeAssuranceError';
  }
}

export interface AgeAssuranceRepositoryPort {
  getStatus(userId: string): Promise<AgeAssuranceStatus | null>;
  savePendingSession(
    userId: string,
    providerSessionRef: string,
    verificationUrl: string,
    now: Date,
  ): Promise<AgeAssuranceSession | null>;
  getSession(userId: string): Promise<AgeAssuranceSession | null>;
  applyDecision(
    userId: string,
    providerSessionRef: string,
    status: 'PENDING' | 'APPROVED' | 'REJECTED',
    now: Date,
  ): Promise<AgeAssuranceStatus | null>;
}

const providerFailureMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim() ? error.message : 'Age assurance provider unavailable';

export class AgeAssuranceService {
  constructor(
    private readonly repository: AgeAssuranceRepositoryPort,
    private readonly provider?: AgeAssuranceProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getStatus(userId: string): Promise<AgeAssuranceStatus | null> {
    return this.repository.getStatus(userId);
  }

  async isApproved(userId: string): Promise<boolean> {
    return (await this.repository.getStatus(userId)) === 'APPROVED';
  }

  async start(userId: string): Promise<{ verificationUrl: string; status: AgeAssuranceStatus }> {
    if (!this.provider) {
      throw new AgeAssuranceError('AGE_PROVIDER_UNAVAILABLE', 'Age assurance is not configured');
    }

    const currentStatus = await this.repository.getStatus(userId);
    if (currentStatus === null) {
      throw new AgeAssuranceError('ACCOUNT_UNAVAILABLE', 'Account is unavailable');
    }

    // Starting a provider session can be billable. If the user already has a
    // pending hosted session, return that same URL instead of creating another
    // external session on repeated taps/retries.
    if (currentStatus === 'PENDING') {
      const existing = await this.repository.getSession(userId);
      if (existing?.status === 'PENDING' && existing.verificationUrl) {
        return { verificationUrl: existing.verificationUrl, status: 'PENDING' };
      }
    }

    let started: Awaited<ReturnType<AgeAssuranceProvider['start']>>;
    try {
      started = await this.provider.start(userId);
    } catch (error) {
      throw new AgeAssuranceError('AGE_PROVIDER_UNAVAILABLE', providerFailureMessage(error));
    }

    const saved = await this.repository.savePendingSession(
      userId,
      started.sessionRef,
      started.verificationUrl,
      this.now(),
    );
    if (!saved) {
      throw new AgeAssuranceError('ACCOUNT_UNAVAILABLE', 'Account is unavailable');
    }
    return { verificationUrl: saved.verificationUrl, status: 'PENDING' };
  }

  async refresh(userId: string): Promise<AgeAssuranceStatus> {
    if (!this.provider) {
      throw new AgeAssuranceError('AGE_PROVIDER_UNAVAILABLE', 'Age assurance is not configured');
    }
    const session = await this.repository.getSession(userId);
    if (!session) {
      throw new AgeAssuranceError('AGE_SESSION_NOT_AVAILABLE', 'Age assurance session unavailable');
    }

    let result: Awaited<ReturnType<AgeAssuranceProvider['getResult']>>;
    try {
      result = await this.provider.getResult(session.providerSessionRef);
    } catch (error) {
      throw new AgeAssuranceError('AGE_PROVIDER_UNAVAILABLE', providerFailureMessage(error));
    }

    const status: 'PENDING' | 'APPROVED' | 'REJECTED' = result.decision;
    const persisted = await this.repository.applyDecision(
      userId,
      session.providerSessionRef,
      status,
      this.now(),
    );
    if (!persisted) {
      throw new AgeAssuranceError('AGE_SESSION_NOT_AVAILABLE', 'Age assurance session unavailable');
    }
    return persisted;
  }
}
