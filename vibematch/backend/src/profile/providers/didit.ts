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
  status?: unknown;
  is_archived?: unknown;
};

type DiditWorkflowListResponse = {
  results?: unknown;
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

  private async resolveWorkflowId(): Promise<string> {
    const configured = this.options.workflowId?.trim();
    if (configured) return configured;
    if (this.discoveredWorkflowId) return this.discoveredWorkflowId;

    const response = await this.fetchImpl(`${this.baseUrl}/v3/workflows/`, {
      headers: {
        accept: 'application/json',
        'x-api-key': this.options.apiKey,
      },
    });
    if (!response.ok) throw new Error(`Didit workflow discovery failed with ${response.status}`);

    const payload = (await response.json()) as DiditWorkflowListResponse;
    const rows = Array.isArray(payload.results) ? (payload.results as DiditWorkflow[]) : [];
    const published = rows.filter(
      (row) =>
        typeof row.status === 'string' &&
        row.status.toLowerCase() === 'published' &&
        row.is_archived !== true,
    );
    if (published.length !== 1) {
      throw new Error('Didit workflow id must be configured when published workflow count is not one');
    }

    const selected = published[0];
    const id =
      typeof selected.workflow_id === 'string'
        ? selected.workflow_id
        : typeof selected.uuid === 'string'
          ? selected.uuid
          : '';
    if (!id.trim()) throw new Error('Didit workflow discovery returned an invalid workflow id');

    this.discoveredWorkflowId = id.trim();
    return this.discoveredWorkflowId;
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
    if (!response.ok) throw new Error(`Didit create session failed with ${response.status}`);
    const payload = (await response.json()) as DiditCreateSessionResponse;
    if (typeof payload.session_id !== 'string' || typeof payload.url !== 'string') {
      throw new Error('Didit create session returned an invalid response');
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
    if (!response.ok) throw new Error(`Didit decision request failed with ${response.status}`);
    const payload = (await response.json()) as DiditDecisionResponse;
    const status = typeof payload.status === 'string' ? payload.status.toUpperCase() : '';
    const decision: AgeAssuranceResult['decision'] =
      status === 'APPROVED' ? 'APPROVED' : status === 'DECLINED' ? 'REJECTED' : 'PENDING';
    return {
      decision,
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
