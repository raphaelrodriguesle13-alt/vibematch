import type { AccountDeletionStatus } from './repository';

export type AccountDeletionErrorCode = 'ACCOUNT_DELETION_UNAVAILABLE';

export class AccountDeletionError extends Error {
  constructor(
    readonly code: AccountDeletionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AccountDeletionError';
  }
}

export interface AccountDeletionRepositoryPort {
  requestDeletion(userId: string): Promise<AccountDeletionStatus | null>;
}

export class AccountDeletionService {
  constructor(private readonly repository: AccountDeletionRepositoryPort) {}

  async requestDeletion(userId: string): Promise<AccountDeletionStatus> {
    if (userId.trim() === '') {
      throw new AccountDeletionError('ACCOUNT_DELETION_UNAVAILABLE', 'Account is unavailable');
    }

    const status = await this.repository.requestDeletion(userId);
    if (!status) {
      throw new AccountDeletionError('ACCOUNT_DELETION_UNAVAILABLE', 'Account is unavailable');
    }
    return status;
  }
}
