import { validateProductionConfig } from '../../backend/src/config/production-validation';

const REQUIRED: Readonly<Record<string, string>> = {
  GOOGLE_OIDC_AUDIENCE: 'android-client.apps.googleusercontent.com',
  JWT_PRIVATE_KEY_PEM: 'private-key-placeholder',
  JWT_PUBLIC_KEY_PEM: 'public-key-placeholder',
  JWT_KEY_ID: '2026-08-primary',
  JWT_ISSUER: 'https://api.vibematch.test',
  JWT_AUDIENCE: 'vibematch-android',
  TWILIO_ACCOUNT_SID: 'AC-test',
  TWILIO_AUTH_TOKEN: 'twilio-secret-placeholder',
  TWILIO_VERIFY_SERVICE_SID: 'VA-test',
  PHONE_HASH_PEPPER: 'phone-pepper-placeholder',
  DIDIT_API_KEY: 'didit-key-placeholder',
  DIDIT_WEBHOOK_SECRET: 'didit-webhook-placeholder',
  LIVEKIT_URL: 'wss://vibematch.test',
  LIVEKIT_API_URL: 'https://vibematch.test',
  LIVEKIT_API_KEY: 'livekit-key-placeholder',
  LIVEKIT_API_SECRET: 'livekit-secret-placeholder',
  GOOGLE_PLAY_PACKAGE_NAME: 'com.vibematch.app',
  GOOGLE_PLAY_PUBSUB_AUDIENCE: 'https://api.vibematch.test/webhooks/google-play/rtdn',
  GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL: 'push@example.iam.gserviceaccount.com',
  OPENAI_API_KEY: 'openai-key-placeholder',
  DATABASE_URL_AUTH: 'postgres://svc_auth:test@localhost:5432/vibematch',
  DATABASE_URL_ACCOUNT: 'postgres://svc_account:test@localhost:5432/vibematch',
  DATABASE_URL_PROFILE: 'postgres://svc_profile:test@localhost:5432/vibematch',
  DATABASE_URL_MATCHMAKING: 'postgres://svc_matchmaking:test@localhost:5432/vibematch',
  DATABASE_URL_MODERATION: 'postgres://svc_moderation:test@localhost:5432/vibematch',
  DATABASE_URL_VIDEO: 'postgres://svc_video:test@localhost:5432/vibematch',
  DATABASE_URL_BILLING: 'postgres://svc_billing:test@localhost:5432/vibematch',
};

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const [name, value] of Object.entries(REQUIRED)) {
    saved.set(name, process.env[name]);
    process.env[name] = value;
  }
  saved.set('DIDIT_WORKFLOW_ID', process.env.DIDIT_WORKFLOW_ID);
  saved.set('JWT_VERIFICATION_PUBLIC_KEYS_JSON', process.env.JWT_VERIFICATION_PUBLIC_KEYS_JSON);
  saved.set('TWILIO_VERIFY_BASE_URL', process.env.TWILIO_VERIFY_BASE_URL);
  saved.set('DIDIT_API_BASE_URL', process.env.DIDIT_API_BASE_URL);
  delete process.env.DIDIT_WORKFLOW_ID;
  delete process.env.JWT_VERIFICATION_PUBLIC_KEYS_JSON;
  delete process.env.TWILIO_VERIFY_BASE_URL;
  delete process.env.DIDIT_API_BASE_URL;
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

describe('validateProductionConfig', () => {
  test('accepts the complete least-privilege runtime configuration', () => {
    expect(() => validateProductionConfig()).not.toThrow();
  });

  test('allows DIDIT_WORKFLOW_ID to be omitted for published KYC discovery', () => {
    delete process.env.DIDIT_WORKFLOW_ID;

    expect(() => validateProductionConfig()).not.toThrow();
  });

  test('fails before runtime construction when a required provider secret is missing', () => {
    delete process.env.DIDIT_WEBHOOK_SECRET;

    expect(() => validateProductionConfig()).toThrow(
      'Missing required environment variable: DIDIT_WEBHOOK_SECRET',
    );
  });

  test('requires the dedicated account deletion database role', () => {
    delete process.env.DATABASE_URL_ACCOUNT;

    expect(() => validateProductionConfig()).toThrow(
      'Missing required environment variable: DATABASE_URL_ACCOUNT',
    );
  });

  test('rejects insecure provider endpoints', () => {
    process.env.TWILIO_VERIFY_BASE_URL = 'http://verify.example.test';

    expect(() => validateProductionConfig()).toThrow(
      'Environment variable TWILIO_VERIFY_BASE_URL must use https://',
    );
  });

  test('rejects non-PostgreSQL runtime database URLs', () => {
    process.env.DATABASE_URL_VIDEO = 'https://database.example.test/vibematch';

    expect(() => validateProductionConfig()).toThrow(
      'Environment variable DATABASE_URL_VIDEO must use postgres: or postgresql:',
    );
  });

  test('does not require owner or migration credentials in the application runtime', () => {
    const databaseUrl = process.env.DATABASE_URL;
    const ownerUrl = process.env.DATABASE_URL_OWNER;
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_OWNER;

    try {
      expect(() => validateProductionConfig()).not.toThrow();
    } finally {
      if (databaseUrl !== undefined) process.env.DATABASE_URL = databaseUrl;
      if (ownerUrl !== undefined) process.env.DATABASE_URL_OWNER = ownerUrl;
    }
  });
});
