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
  return v;
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

  /** V1.2 D3 — 1 hora por padrão, ajustável sem alterar regra de negócio. */
  consentVideoDeadlineSeconds: intFromEnv('CONSENT_VIDEO_DEADLINE_SECONDS', 3600),

  consentDecisionExpirySeconds: intFromEnv('CONSENT_DECISION_EXPIRY_SECONDS', 86400),

  /** 'env' apenas para desenvolvimento/teste; produção usa GCP Secret Manager. */
  secretBackend: (process.env.SECRET_BACKEND ?? 'env') as 'env' | 'gcp-secret-manager',

  databaseUrl: () => required('DATABASE_URL'),
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
