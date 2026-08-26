export type AgeAssuranceStatus = 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AgeAssuranceRepositoryPort {
  getStatus(userId: string): Promise<AgeAssuranceStatus | null>;
}

export class AgeAssuranceService {
  constructor(private readonly repository: AgeAssuranceRepositoryPort) {}

  getStatus(userId: string): Promise<AgeAssuranceStatus | null> {
    return this.repository.getStatus(userId);
  }

  async isApproved(userId: string): Promise<boolean> {
    return (await this.repository.getStatus(userId)) === 'APPROVED';
  }
}
