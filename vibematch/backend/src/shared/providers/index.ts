/**
 * Interfaces de fornecedor — Blueprint V1.2 §1.3 / §15 (fornecedores substituíveis).
 * O domínio de negócio nunca importa um SDK de fornecedor diretamente.
 */

export interface GoogleIdentity {
  subject: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  avatarUrl?: string;
}

/** V1.2 §1.4/§3.1 — validação do ID token acontece server-side. */
export interface GoogleIdentityProvider {
  verifyIdToken(idToken: string): Promise<GoogleIdentity>;
}

export interface SmsVerificationStart {
  providerVerificationId: string;
  expiresAt: Date;
}

/** Provedor substituível; o domínio não armazena código SMS em texto puro. */
export interface SmsVerificationProvider {
  start(userId: string, phoneE164: string): Promise<SmsVerificationStart>;
  confirm(providerVerificationId: string, code: string): Promise<boolean>;
}

export interface SessionTokenClaims {
  userId: string;
  sessionId: string;
  phoneVerified: boolean;
}

/** JWT curto assinado server-side; chave resolvida fora do domínio. */
export interface SessionTokenProvider {
  issue(claims: SessionTokenClaims, expiresAt: Date): Promise<string>;
}

/** Verificação independente para middleware HTTP e serviços internos. */
export interface SessionTokenVerifier {
  verify(token: string): Promise<SessionTokenClaims>;
}

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

/** Contrato do domínio; a aplicação não importa SDK de fornecedor. */
export interface ChatGptProvider {
  generate(params: ChatGptGenerateParams): Promise<ChatGptGenerateResult>;
}
