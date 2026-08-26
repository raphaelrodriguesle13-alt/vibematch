import {
  ModerationError,
  ModerationService,
  type Block,
  type ModerationRepositoryPort,
  type Report,
  type ReportCategory,
  type ReportSeverity,
} from '../../backend/src/moderation/service';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

class FakeRepository implements ModerationRepositoryPort {
  reportInput: {
    reporterId: string;
    reportedId: string;
    sessionId: string | null;
    category: ReportCategory;
    severity: ReportSeverity;
    requiresHuman: boolean;
  } | null = null;

  createBlock(blockerId: string, blockedId: string): Promise<Block> {
    return Promise.resolve({
      id: '44444444-4444-4444-8444-444444444444',
      blockerId,
      blockedId,
      createdAt: new Date('2026-08-26T10:00:00.000Z'),
    });
  }

  createReport(input: {
    reporterId: string;
    reportedId: string;
    sessionId: string | null;
    category: ReportCategory;
    severity: ReportSeverity;
    requiresHuman: boolean;
  }): Promise<Report> {
    this.reportInput = input;
    return Promise.resolve({
      id: '55555555-5555-4555-8555-555555555555',
      reporterId: input.reporterId,
      reportedId: input.reportedId,
      sessionId: input.sessionId,
      category: input.category,
      severity: input.severity,
      status: 'OPEN',
      createdAt: new Date('2026-08-26T10:00:00.000Z'),
    });
  }
}

describe('ModerationService', () => {
  test('rejects self-block before repository access', async () => {
    const service = new ModerationService(new FakeRepository());
    await expect(service.block(USER_A, USER_A)).rejects.toMatchObject({
      code: 'INVALID_MODERATION_REQUEST',
    } satisfies Partial<ModerationError>);
  });

  test('derives report severity server-side instead of accepting client severity', async () => {
    const repository = new FakeRepository();
    const service = new ModerationService(repository);

    await service.report(USER_A, {
      reportedId: USER_B,
      sessionId: SESSION_ID,
      category: 'SEXUAL_CONTENT',
    });

    expect(repository.reportInput).toMatchObject({
      reporterId: USER_A,
      reportedId: USER_B,
      sessionId: SESSION_ID,
      severity: 'CRITICAL',
      requiresHuman: true,
    });
  });

  test('rejects unknown report categories', async () => {
    const service = new ModerationService(new FakeRepository());
    await expect(
      service.report(USER_A, { reportedId: USER_B, category: 'CLIENT_DEFINED_SEVERITY' }),
    ).rejects.toMatchObject({ code: 'INVALID_MODERATION_REQUEST' });
  });
});
