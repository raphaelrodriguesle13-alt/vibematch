/**
 * Configuração por ambiente — Blueprint V1.2 §6.6.
 * Nenhum segredo tem valor padrão. Ausência de variável obrigatória = falha na
 * inicialização (fail-closed), nunca um fallback silencioso.
 */

export type Environment = 'development' | 'test' | 'production';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

function requiredUrl(name: string, protocol: 'https:' | 'wss:'): string {
  const value = required(name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Environment variable ${name} must be a valid URL`);
  }
  if (parsed.protocol !== protocol) {
    throw new Error(`Environment variable ${name} must use ${protocol.replace(':', '://')}`);
  }
  return value.replace(/\/+$/, '');
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be an integer`);
  return n;
}

function optionalStringRecord(name: string): Readonly<Record<string, string>> {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Environment variable ${name} must be a JSON object`);
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`Environment variable ${name} must be a JSON object`);
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (
      key.trim() === '' ||
      key !== key.trim() ||
      typeof value !== 'string' ||
      value.trim() === ''
    ) {
      throw new Error(`Environment variable ${name} must map non-empty key ids to public keys`);
    }
    result[key] = value.replace(/\\n/g, '\n');
  }
  return result;
}

export const env = {
  nodeEnv: (process.env.NODE_ENV ?? 'development') as Environment,
  port: intFromEnv('PORT', 3000),
  host: process.env.HOST?.trim() || '0.0.0.0',
  videoRevocationIntervalMs: intFromEnv('VIDEO_REVOCATION_INTERVAL_MS', 5_000),
  sessionInactivityTimeoutSeconds: intFromEnv('SESSION_INACTIVITY_TIMEOUT_SECONDS', 60),
  authSessionTtlSeconds: intFromEnv('AUTH_SESSION_TTL_SECONDS', 15 * 60),
  authRefreshRateWindowSeconds: intFromEnv('AUTH_REFRESH_RATE_WINDOW_SECONDS', 60),
  authRefreshGlobalLimit: intFromEnv('AUTH_REFRESH_GLOBAL_LIMIT', 600),
  authRefreshCredentialLimit: intFromEnv('AUTH_REFRESH_CREDENTIAL_LIMIT', 10),
  consentVideoDeadlineSeconds: intFromEnv('CONSENT_VIDEO_DEADLINE_SECONDS', 3600),
  consentDecisionExpirySeconds: intFromEnv('CONSENT_DECISION_EXPIRY_SECONDS', 86400),
  databaseConnectionTimeoutMs: intFromEnv('DATABASE_CONNECTION_TIMEOUT_MS', 3_000),
  readinessTimeoutMs: intFromEnv('READINESS_TIMEOUT_MS', 2_000),

  googleOidcAudience: () => required('GOOGLE_OIDC_AUDIENCE'),
  jwtPrivateKeyPem: () => required('JWT_PRIVATE_KEY_PEM').replace(/\\n/g, '\n'),
  jwtPublicKeyPem: () => required('JWT_PUBLIC_KEY_PEM').replace(/\\n/g, '\n'),
  jwtKeyId: () => required('JWT_KEY_ID'),
  jwtVerificationPublicKeys: () => optionalStringRecord('JWT_VERIFICATION_PUBLIC_KEYS_JSON'),
  jwtIssuer: () => required('JWT_ISSUER'),
  jwtAudience: () => required('JWT_AUDIENCE'),

  twilioAccountSid: () => required('TWILIO_ACCOUNT_SID'),
  twilioAuthToken: () => required('TWILIO_AUTH_TOKEN'),
  twilioVerifyServiceSid: () => required('TWILIO_VERIFY_SERVICE_SID'),
  twilioVerifyBaseUrl: () =>
    process.env.TWILIO_VERIFY_BASE_URL
      ? requiredUrl('TWILIO_VERIFY_BASE_URL', 'https:')
      : 'https://verify.twilio.com',
  phoneHashPepper: () => required('PHONE_HASH_PEPPER'),

  diditApiKey: () => required('DIDIT_API_KEY'),
  // Optional selector: UUID or public workflow URL. Empty means discover the unique published KYC.
  diditWorkflowId: () => process.env.DIDIT_WORKFLOW_ID?.trim() ?? '',
  diditWebhookSecret: () => required('DIDIT_WEBHOOK_SECRET'),
  diditApiBaseUrl: () =>
    process.env.DIDIT_API_BASE_URL
      ? requiredUrl('DIDIT_API_BASE_URL', 'https:')
      : 'https://verification.didit.me',

  liveKitRtcUrl: () => requiredUrl('LIVEKIT_URL', 'wss:'),
  liveKitApiUrl: () => requiredUrl('LIVEKIT_API_URL', 'https:'),
  liveKitApiKey: () => required('LIVEKIT_API_KEY'),
  liveKitApiSecret: () => required('LIVEKIT_API_SECRET'),

  googlePlayPackageName: () => required('GOOGLE_PLAY_PACKAGE_NAME'),
  googlePlayApiBaseUrl:
    process.env.GOOGLE_PLAY_API_BASE_URL ?? 'https://androidpublisher.googleapis.com',
  googlePlayPubSubAudience: () => required('GOOGLE_PLAY_PUBSUB_AUDIENCE'),
  googlePlayPubSubServiceAccountEmail: () => required('GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL'),

  openAiApiKey: () => required('OPENAI_API_KEY'),
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  openAiModel: process.env.OPENAI_MODEL ?? 'gpt-5.6',
  openAiTimeoutMs: intFromEnv('OPENAI_TIMEOUT_MS', 30_000),

  secretBackend: (process.env.SECRET_BACKEND ?? 'env') as 'env' | 'gcp-secret-manager',

  databaseUrl: () => required('DATABASE_URL'),
  authDatabaseUrl: () => required('DATABASE_URL_AUTH'),
  accountDatabaseUrl: () => required('DATABASE_URL_ACCOUNT'),
  profileDatabaseUrl: () => required('DATABASE_URL_PROFILE'),
  matchmakingDatabaseUrl: () => required('DATABASE_URL_MATCHMAKING'),
  moderationDatabaseUrl: () => required('DATABASE_URL_MODERATION'),
  videoDatabaseUrl: () => required('DATABASE_URL_VIDEO'),
  billingDatabaseUrl: () => required('DATABASE_URL_BILLING'),
} as const;

export interface SecretResolver {
  get(key: string): Promise<string>;
}

export class EnvSecretResolver implements SecretResolver {
  get(key: string): Promise<string> {
    return Promise.resolve(required(key));
  }
}
