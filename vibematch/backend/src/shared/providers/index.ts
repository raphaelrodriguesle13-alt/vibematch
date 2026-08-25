/**
 * Interfaces de fornecedor — Blueprint V1.2 §1.3 / §15 (fornecedores substituíveis).
 * SOMENTE CONTRATOS. Nenhuma implementação de fornecedor nesta etapa (0/1).
 * O domínio de negócio nunca importa um SDK de fornecedor diretamente.
 */

export type AgeAssuranceDecision = 'APPROVED' | 'REJECTED' | 'PENDING';

export interface AgeAssuranceResult {
  decision: AgeAssuranceDecision;
  estimatedAgeRange?: { min: number; max: number };
  confidence?: number;
  providerTransactionId: string;
}

/** V1.2 §6.7 — o cliente NUNCA decide aprovação; falha do provedor é fail-closed. */
export interface AgeAssuranceProvider {
  start(userId: string): Promise<{ sessionRef: string }>;
  getResult(sessionRef: string): Promise<AgeAssuranceResult>;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}

/** V1.2 §8 — LiveKit Cloud (MVP). Revogação ativa é parte do contrato. */
export interface RTCProvider {
  issueToken(params: {
    room: string;
    identity: string;
    ttlSeconds: number;
  }): Promise<{ token: string; expiresAt: Date }>;
  terminateRoom(room: string): Promise<void>;
  removeParticipant(room: string, identity: string): Promise<void>;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}

/** V1.2 §11 — Android nunca é autoridade sobre entitlement. */
export interface PaymentsProvider {
  verifyPurchase(purchaseToken: string): Promise<{
    valid: boolean;
    plan: string;
    expiryTime: Date;
    state: string;
  }>;
  verifyNotificationSignature(rawBody: Buffer, signature: string): boolean;
}

export interface NotificationsProvider {
  sendToDevice(fcmToken: string, payload: Record<string, string>): Promise<void>;
}

export interface AdsProvider {
  readonly name: string;
}

/** Mensagens aceitas pelo adaptador server-side da OpenAI Responses API. */
export type ChatGptMessageRole = 'developer' | 'system' | 'user' | 'assistant';

export interface ChatGptMessage {
  role: ChatGptMessageRole;
  content: string;
}

export interface ChatGptGenerateParams {
  messages: ChatGptMessage[];
}

export interface ChatGptGenerateResult {
  id: string;
  model: string;
  text: string;
}

/** Contrato do domínio; nenhuma camada de aplicação importa o SDK do fornecedor. */
export interface ChatGptProvider {
  generate(params: ChatGptGenerateParams): Promise<ChatGptGenerateResult>;
}
