import {
  AgeAssuranceService,
  type AgeAssuranceRepositoryPort,
  type AgeAssuranceSession,
  type AgeAssuranceStatus,
} from '../../backend/src/profile/age-assurance';

class FakeAgeAssuranceRepository implements AgeAssuranceRepositoryPort {
  session: AgeAssuranceSession | null = null;

  constructor(private status: AgeAssuranceStatus | null) {}

  getStatus(): Promise<AgeAssuranceStatus | null> {
    return Promise.resolve(this.status);
  }

  savePendingSession(
    userId: string,
    providerSessionRef: string,
    verificationUrl: string,
  ): Promise<AgeAssuranceSession | null> {
    if (this.status === null) return Promise.resolve(null);
    this.status = 'PENDING';
    this.session = {
      userId,
      providerSessionRef,
      verificationUrl,
      status: 'PENDING',
    };
    return Promise.resolve(this.session);
  }

  getSession(): Promise<AgeAssuranceSession | null> {
    return Promise.resolve(this.session);
  }

  applyDecision(
    _userId: string,
    _providerSessionRef: string,
    status: 'PENDING' | 'APPROVED' | 'REJECTED',
  ): Promise<AgeAssuranceStatus | null> {
    if (!this.session) return Promise.resolve(null);
    this.status = status;
    this.session.status = status;
    return Promise.resolve(status);
  }
}

describe('AgeAssuranceService', () => {
  test.each<AgeAssuranceStatus | null>(['NOT_STARTED', 'PENDING', 'REJECTED', null])(
    'fails closed when status is %s',
    async (status) => {
      const service = new AgeAssuranceService(new FakeAgeAssuranceRepository(status));
      await expect(service.isApproved('user-1')).resolves.toBe(false);
    },
  );

  test('allows restricted functionality only for APPROVED users', async () => {
    const service = new AgeAssuranceService(new FakeAgeAssuranceRepository('APPROVED'));
    await expect(service.isApproved('user-1')).resolves.toBe(true);
  });

  test('starts a hosted provider session and persists only its reference and URL', async () => {
    const repository = new FakeAgeAssuranceRepository('NOT_STARTED');
    const provider = {
      start: jest.fn().mockResolvedValue({
        sessionRef: 'didit-session-1',
        verificationUrl: 'https://verify.didit.me/session/example',
      }),
      getResult: jest.fn(),
      verifyWebhookSignature: jest.fn(),
    };
    const service = new AgeAssuranceService(repository, provider);

    await expect(service.start('user-1')).resolves.toEqual({
      verificationUrl: 'https://verify.didit.me/session/example',
      status: 'PENDING',
    });
    expect(repository.session?.providerSessionRef).toBe('didit-session-1');
  });

  test('refreshes provider decision server-side and only then approves the user', async () => {
    const repository = new FakeAgeAssuranceRepository('PENDING');
    repository.session = {
      userId: 'user-1',
      providerSessionRef: 'didit-session-1',
      verificationUrl: 'https://verify.didit.me/session/example',
      status: 'PENDING',
    };
    const provider = {
      start: jest.fn(),
      getResult: jest.fn().mockResolvedValue({
        decision: 'APPROVED' as const,
        providerTransactionId: 'didit-session-1',
      }),
      verifyWebhookSignature: jest.fn(),
    };
    const service = new AgeAssuranceService(repository, provider);

    await expect(service.refresh('user-1')).resolves.toBe('APPROVED');
    await expect(service.isApproved('user-1')).resolves.toBe(true);
  });

  test('fails closed when Didit is unavailable', async () => {
    const repository = new FakeAgeAssuranceRepository('PENDING');
    repository.session = {
      userId: 'user-1',
      providerSessionRef: 'didit-session-1',
      verificationUrl: 'https://verify.didit.me/session/example',
      status: 'PENDING',
    };
    const service = new AgeAssuranceService(repository, {
      start: jest.fn(),
      getResult: jest.fn().mockRejectedValue(new Error('provider down')),
      verifyWebhookSignature: jest.fn(),
    });

    await expect(service.refresh('user-1')).rejects.toMatchObject({
      code: 'AGE_PROVIDER_UNAVAILABLE',
    });
    await expect(service.isApproved('user-1')).resolves.toBe(false);
  });
});
