import {
  AgeAssuranceService,
  type AgeAssuranceRepositoryPort,
  type AgeAssuranceStatus,
} from '../../backend/src/profile/age-assurance';

class FakeAgeAssuranceRepository implements AgeAssuranceRepositoryPort {
  constructor(private readonly status: AgeAssuranceStatus | null) {}

  getStatus(): Promise<AgeAssuranceStatus | null> {
    return Promise.resolve(this.status);
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
});
