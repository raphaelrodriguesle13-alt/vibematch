import { env } from './env';

function assertUrlProtocol(name: string, value: string, protocols: readonly string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Environment variable ${name} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`Environment variable ${name} must use ${protocols.join(' or ')}`);
  }
}

function assertPostgresUrl(name: string, value: string): void {
  assertUrlProtocol(name, value, ['postgres:', 'postgresql:']);
}

/**
 * Resolve and validate every credential/configuration category required by the
 * production application before pools or external-provider clients are built.
 *
 * Deliberately excludes DATABASE_URL / DATABASE_URL_OWNER: migrations run under
 * a separate owner boundary; the application runtime must retain least privilege.
 */
export function validateProductionConfig(): void {
  env.googleOidcAudience();
  env.jwtPrivateKeyPem();
  env.jwtPublicKeyPem();
  env.jwtKeyId();
  env.jwtVerificationPublicKeys();
  env.jwtIssuer();
  env.jwtAudience();

  env.twilioAccountSid();
  env.twilioAuthToken();
  env.twilioVerifyServiceSid();
  env.phoneHashPepper();
  assertUrlProtocol('TWILIO_VERIFY_BASE_URL', env.twilioVerifyBaseUrl(), ['https:']);

  env.diditApiKey();
  env.diditWorkflowId();
  env.diditWebhookSecret();
  assertUrlProtocol('DIDIT_API_BASE_URL', env.diditApiBaseUrl(), ['https:']);

  env.liveKitApiKey();
  env.liveKitApiSecret();
  assertUrlProtocol('LIVEKIT_URL', env.liveKitRtcUrl(), ['wss:']);
  assertUrlProtocol('LIVEKIT_API_URL', env.liveKitApiUrl(), ['https:']);

  env.googlePlayPackageName();
  env.googlePlayPubSubAudience();
  env.googlePlayPubSubServiceAccountEmail();
  assertUrlProtocol('GOOGLE_PLAY_API_BASE_URL', env.googlePlayApiBaseUrl, ['https:']);

  env.openAiApiKey();
  assertUrlProtocol('OPENAI_BASE_URL', env.openAiBaseUrl, ['https:']);

  assertPostgresUrl('DATABASE_URL_AUTH', env.authDatabaseUrl());
  assertPostgresUrl('DATABASE_URL_ACCOUNT', env.accountDatabaseUrl());
  assertPostgresUrl('DATABASE_URL_PROFILE', env.profileDatabaseUrl());
  assertPostgresUrl('DATABASE_URL_MATCHMAKING', env.matchmakingDatabaseUrl());
  assertPostgresUrl('DATABASE_URL_MODERATION', env.moderationDatabaseUrl());
  assertPostgresUrl('DATABASE_URL_VIDEO', env.videoDatabaseUrl());
  assertPostgresUrl('DATABASE_URL_BILLING', env.billingDatabaseUrl());
}
