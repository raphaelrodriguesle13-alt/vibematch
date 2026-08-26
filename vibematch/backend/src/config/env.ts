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

export const env = {
  nodeEnv: (process.env.NODE_ENV ?? 'development') as Environment,

  /** V1.2 D2 — configuração server-side, nunca constante embutida. */
  sessionInactivityTimeoutSeconds: intFromEnv('SESSION_INACTIVITY_TIMEOUT_SECONDS', 60),
  authSessionTtlSeconds: intFromEnv('AUTH_SESSION_TTL_SECONDS', 15 * 60),

  /** V1.2 D3 — 1 hora por padrão, ajustável sem alterar regra de negócio. */
  consentVideoDeadlineSeconds: intFromEnv('CONSENT_VIDEO_DEADLINE_SECONDS', 3600),

  consentDecisionExpirySeconds: intFromEnv('CONSENT_DECISION_EXPIRY_SECONDS', 86400),

  /** Auth/OIDC/JWT. Chaves privadas são server-side only. */
  googleOidcAudience: () => required('GOOGLE_OIDC_AUDIENCE'),
  jwtPrivateKeyPem: () => required('JWT_PRIVATE_KEY_PEM').replace(/\\n/g, '\n'),
  jwtPublicKeyPem: () => required('JWT_PUBLIC_KEY_PEM').replace(/\\n/g, '\n'),
  jwtIssuer: () => required('JWT_ISSUER'),
  jwtAudience: () => required('JWT_AUDIENCE'),

  /** LiveKit RTC público consumido pelo cliente. Nunca contém segredo. */
  liveKitRtcUrl: () => requiredUrl('LIVEKIT_URL', 'wss:'),

  /** LiveKit API administrativa usada somente no backend. */
  liveKitApiUrl: () => requiredUrl('LIVEKIT_API_URL', 'https:'),
  liveKitApiKey: () => required('LIVEKIT_API_KEY'),
  liveKitApiSecret: () => required('LIVEKIT_API_SECRET'),

  /** Google Play Android Publisher API. Credenciais vêm de ADC/Workload Identity. */
  googlePlayPackageName: () => required('GOOGLE_PLAY_PACKAGE_NAME'),
  googlePlayApiBaseUrl:
    process.env.GOOGLE_PLAY_API_BASE_URL ?? 'https://androidpublisher.googleapis.com',
  googlePlayPubSubAudience: () => required('GOOGLE_PLAY_PUBSUB_AUDIENCE'),
  googlePlayPubSubServiceAccountEmail: () =>
    required('GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL'),

  /** ChatGPT é acessado apenas pelo backend; a chave é resolvida somente no uso. */
  openAiApiKey: () => required('OPENAI_API_KEY'),
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  openAiModel: process.env.OPENAI_MODEL ?? 'gpt-5.6',
  openAiTimeoutMs: intFromEnv('OPENAI_TIMEOUT_MS', 30_000),

  /** 'env' apenas para desenvolvimento/teste; produção usa GCP Secret Manager. */
  secretBackend: (process.env.SECRET_BACKEND ?? 'env') as 'env' | 'gcp-secret-manager',

  /** Owner/migrations. Runtime services must use their least-privilege role. */
  databaseUrl: () => required('DATABASE_URL'),
  authDatabaseUrl: () => required('DATABASE_URL_AUTH'),
  profileDatabaseUrl: () => required('DATABASE_URL_PROFILE'),
  matchmakingDatabaseUrl: () => required('DATABASE_URL_MATCHMAKING'),
  moderationDatabaseUrl: () => required('DATABASE_URL_MODERATION'),
  videoDatabaseUrl: () => required('DATABASE_URL_VIDEO'),
  billingDatabaseUrl: () => required('DATABASE_URL_BILLING'),
} as const;

/**
 * Abstração de segredos. Etapa 0 implementa apenas o backend 'env'.
 * O adaptador GCP Secret Manager entra nas etapas 2+ sem alterar chamadores.
 */
export interface SecretResolver {
  get(key: string): Promise<string>;
}

export class EnvSecretResolver implements SecretResolver {
  get(key: string): Promise<string> {
    return Promise.resolve(required(key));
  }
}
