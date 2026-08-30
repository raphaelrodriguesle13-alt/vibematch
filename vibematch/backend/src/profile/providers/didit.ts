import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AgeAssuranceProvider, AgeAssuranceResult } from '../../shared/providers';

type DiditOptions = {
  apiKey: string;
  workflowId?: string;
  webhookSecret?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

type DiditCreateSessionResponse = {
  session_id?: unknown;
  url?: unknown;
};

type DiditDecisionResponse = {
  session_id?: unknown;
  status?: unknown;
};

type DiditWorkflow = {
  uuid?: unknown;
  workflow_id?: unknown;
  workflow_url?: unknown;
  workflow_type?: unknown;
  is_default?: unknown;
  is_archived?: unknown;
  status?: unknown;
};

type DiditOperation = 'workflow_discovery' | 'workflow_selection' | 'session_creation' | 'decision';

export class DiditProviderError extends Error {
  constructor(
    readonly operation: DiditOperation,
    readonly status?: number,
  ) {
    super(`Didit ${operation} failed${status === undefined ? '' : ` with ${status}`}`);
    this.name = 'DiditProviderError';
  }
}

const DIDIT_WORKFLOW_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isDiditWorkflow = (value: unknown): value is DiditWorkflow => isObject(value);

const workflowIdentifier = (workflow: DiditWorkflow): string | undefined => {
  if (typeof workflow.workflow_id === 'string' && workflow.workflow_id.trim()) {
    return workflow.workflow_id.trim();
  }
  if (typeof workflow.uuid === 'string' && workflow.uuid.trim()) return workflow.uuid.trim();
  return undefined;
};

const workflowType = (workflow: DiditWorkflow): string =>
  typeof workflow.workflow_type === 'string' ? workflow.workflow_type.trim().toLowerCase() : '';

const publicWorkflowToken = (value: string): string | undefined => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'verify.didit.me') return undefined;
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts.length >= 2 && parts[0] === 'u' ? parts[1] : undefined;
  } catch {
    return value.includes('/') ? undefined : value;
  }
};

const workflowMatchesSelector = (workflow: DiditWorkflow, selector: string): boolean => {
  const identifier = workflowIdentifier(workflow);
  if (identifier === selector) return true;
  if (typeof workflow.uuid === 'string' && workflow.uuid.trim() === selector) return true;
  if (typeof workflow.workflow_url !== 'string') return false;
  if (workflow.workflow_url.trim() === selector) return true;

  const selectorToken = publicWorkflowToken(selector);
  const workflowToken = publicWorkflowToken(workflow.workflow_url.trim());
  return Boolean(selectorToken && workflowToken && selectorToken === workflowToken);
};

const decisionFromStatus = (status: unknown): AgeAssuranceResult['decision'] => {
  const normalized = typeof status === 'string' ? status.trim().toUpperCase() : '';
  if (normalized === 'APPROVED') return 'APPROVED';
  if (
    normalized === 'DECLINED' ||
    normalized === 'ABANDONED' ||
    normalized === 'EXPIRED' ||
    normalized === 'KYC EXPIRED'
  ) {
    return 'REJECTED';
  }
  return 'PENDING';
};

export class DiditAgeAssuranceProvider implements AgeAssuranceProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private discoveredWorkflowId?: string;

  constructor(private readonly options: DiditOptions) {
    if (!options.apiKey.trim()) {
      throw new Error('Didit API key is required');
    }
    this.baseUrl = (options.baseUrl ?? 'https://verification.didit.me').replace(/\/+$/, '');
    const parsed = new URL(this.baseUrl);
    if (parsed.protocol !== 'https:') throw new Error('Didit base URL must use HTTPS');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async listWorkflows(): Promise<DiditWorkflow[]> {
    const response = await this.fetchImpl(`${this.baseUrl}/v3/workflows/`, {
      headers: {
        accept: 'application/json',
        'x-api-key': this.options.apiKey,
      },
    });
    if (!response.ok) throw new DiditProviderError('workflow_discovery', response.status);

    const payload: unknown = await response.json();
    let rawRows: unknown[] = [];
    if (Array.isArray(payload)) {
      rawRows = payload;
    } else if (isObject(payload) && Array.isArray(payload.results)) {
      rawRows = payload.results;
    }
    return rawRows.filter(isDiditWorkflow);
  }

  private async resolveWorkflowId(): Promise<string> {
    if (this.discoveredWorkflowId) return this.discoveredWorkflowId;

    const configured = this.options.workflowId?.trim();
    if (configured && DIDIT_WORKFLOW_UUID.test(configured)) {
      this.discoveredWorkflowId = configured;
      return configured;
    }

    const rows = await this.listWorkflows();
    const published = rows.filter(
      (row) =>
        row.is_archived !== true &&
        (typeof row.status !== 'string' || row.status.toLowerCase() === 'published') &&
        workflowIdentifier(row),
    );

    if (configured) {
      const configuredMatch = published.find((row) => workflowMatchesSelector(row, configured));
      const configuredId = configuredMatch ? workflowIdentifier(configuredMatch) : undefined;
      if (configuredId) {
        this.discoveredWorkflowId = configuredId;
        return configuredId;
      }
    }

    const adaptiveAge = published.filter(
      (row) => workflowType(row) === 'adaptive_age_verification',
    );
    const kyc = published.filter((row) => workflowType(row) === 'kyc');
    const eligible = adaptiveAge.length > 0 ? adaptiveAge : kyc;

    let selected: DiditWorkflow | undefined;
    if (eligible.length === 1) {
      selected = eligible[0];
    } else if (eligible.length > 1) {
      const defaults = eligible.filter((row) => row.is_default === true);
      if (defaults.length === 1) selected = defaults[0];
    }

    const discovered = selected ? workflowIdentifier(selected) : undefined;
    if (!discovered) throw new DiditProviderError('workflow_selection');

    this.discoveredWorkflowId = discovered;
    return discovered;
  }

  async start(userId: string): Promise<{ sessionRef: string; verificationUrl: string }> {
    const workflowId = await this.resolveWorkflowId();
    const response = await this.fetchImpl(`${this.baseUrl}/v3/session/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.options.apiKey,
      },
      body: JSON.stringify({
        workflow_id: workflowId,
        vendor_data: userId,
      }),
    });
    if (!response.ok) throw new DiditProviderError('session_creation', response.status);
    const payload = (await response.json()) as DiditCreateSessionResponse;
    if (typeof payload.session_id !== 'string' || typeof payload.url !== 'string') {
      throw new DiditProviderError('session_creation');
    }
    const verificationUrl = new URL(payload.url);
    if (verificationUrl.protocol !== 'https:') {
      throw new Error('Didit verification URL must use HTTPS');
    }
    return { sessionRef: payload.session_id, verificationUrl: payload.url };
  }

  async getResult(sessionRef: string): Promise<AgeAssuranceResult> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v3/session/${encodeURIComponent(sessionRef)}/decision/`,
      { headers: { 'x-api-key': this.options.apiKey } },
    );
    if (!response.ok) throw new DiditProviderError('decision', response.status);
    const payload = (await response.json()) as DiditDecisionResponse;
    return {
      decision: decisionFromStatus(payload.status),
      providerTransactionId:
        typeof payload.session_id === 'string' ? payload.session_id : sessionRef,
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const secret = this.options.webhookSecret;
    if (!secret?.trim() || !signature.trim()) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const actualBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    return (
      actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }
}
