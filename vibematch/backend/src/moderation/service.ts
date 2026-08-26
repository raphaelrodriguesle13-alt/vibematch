export type ReportCategory =
  | 'HARASSMENT'
  | 'HATE'
  | 'SEXUAL_CONTENT'
  | 'SCAM'
  | 'SPAM'
  | 'OTHER';
export type ReportSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type Block = {
  id: string;
  blockerId: string;
  blockedId: string;
  createdAt: Date;
};

export type Report = {
  id: string;
  reporterId: string;
  reportedId: string;
  sessionId: string | null;
  category: ReportCategory;
  severity: ReportSeverity;
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'ESCALATED';
  createdAt: Date;
};

export interface ModerationRepositoryPort {
  createBlock(blockerId: string, blockedId: string): Promise<Block | null>;
  createReport(input: {
    reporterId: string;
    reportedId: string;
    sessionId: string | null;
    category: ReportCategory;
    severity: ReportSeverity;
    requiresHuman: boolean;
  }): Promise<Report | null>;
}

export type ModerationErrorCode =
  | 'INVALID_MODERATION_REQUEST'
  | 'BLOCK_NOT_AVAILABLE'
  | 'REPORT_NOT_AVAILABLE';

export class ModerationError extends Error {
  constructor(
    readonly code: ModerationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ModerationError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set<ReportCategory>([
  'HARASSMENT',
  'HATE',
  'SEXUAL_CONTENT',
  'SCAM',
  'SPAM',
  'OTHER',
]);

const severityForCategory = (category: ReportCategory): ReportSeverity => {
  switch (category) {
    case 'HATE':
    case 'SEXUAL_CONTENT':
      return 'CRITICAL';
    case 'HARASSMENT':
    case 'SCAM':
      return 'HIGH';
    case 'SPAM':
      return 'MEDIUM';
    case 'OTHER':
      return 'LOW';
  }
};

export class ModerationService {
  constructor(private readonly repository: ModerationRepositoryPort) {}

  async block(blockerId: string, blockedId: string): Promise<Block> {
    if (!UUID.test(blockerId) || !UUID.test(blockedId) || blockerId === blockedId) {
      throw new ModerationError('INVALID_MODERATION_REQUEST', 'Block request is invalid');
    }
    const block = await this.repository.createBlock(blockerId, blockedId);
    if (!block) {
      throw new ModerationError('BLOCK_NOT_AVAILABLE', 'Block could not be created');
    }
    return block;
  }

  async report(
    reporterId: string,
    input: { reportedId: string; sessionId?: string | null; category: string },
  ): Promise<Report> {
    if (
      !UUID.test(reporterId) ||
      !UUID.test(input.reportedId) ||
      reporterId === input.reportedId ||
      !CATEGORIES.has(input.category as ReportCategory)
    ) {
      throw new ModerationError('INVALID_MODERATION_REQUEST', 'Report request is invalid');
    }
    const sessionId = input.sessionId ?? null;
    if (sessionId !== null && !UUID.test(sessionId)) {
      throw new ModerationError('INVALID_MODERATION_REQUEST', 'Report session is invalid');
    }

    const category = input.category as ReportCategory;
    const severity = severityForCategory(category);
    const report = await this.repository.createReport({
      reporterId,
      reportedId: input.reportedId,
      sessionId,
      category,
      severity,
      requiresHuman: severity === 'HIGH' || severity === 'CRITICAL',
    });
    if (!report) {
      throw new ModerationError('REPORT_NOT_AVAILABLE', 'Report could not be created');
    }
    return report;
  }
}
