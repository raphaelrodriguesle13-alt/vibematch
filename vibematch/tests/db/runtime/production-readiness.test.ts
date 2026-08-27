import { generateKeyPairSync } from 'node:crypto';
import { createProductionRuntime } from '../../../backend/src/runtime/production';

const { privateKey: JWT_PRIVATE_KEY_PEM, publicKey: JWT_PUBLIC_KEY_PEM } = generateKeyPairSync(
  'rsa',
  {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  },
);

const PROVIDER_ENV: Readonly<Record<string, string>> = {
  GOOGLE_OIDC_AUDIENCE: 'android-client.apps.googleusercontent.com',
  JWT_PRIVATE_KEY_PEM,
  JWT_PUBLIC_KEY_PEM,
  JWT_KEY_ID: '2026-08-primary',
  JWT_ISSUER: 'https://api.vibematch.test',
  JWT_AUDIENCE: 'vibematch-android',
  TWILIO_ACCOUNT_SID: 'AC-test',
  TWILIO_AUTH_TOKEN: 'twilio-secret-placeholder',
  TWILIO_VERIFY_SERVICE_SID: 'VA-test',
  PHONE_HASH_PEPPER: 'phone-pepper-placeholder',
  DIDIT_API_KEY: 'didit-key-placeholder',
  DIDIT_WORKFLOW_ID: 'didit-workflow',
  DIDIT_WEBHOOK_SECRET: 'didit-webhook-placeholder',
  LIVEKIT_URL: 'wss://vibematch.test',
  LIVEKIT_API_URL: 'https://vibematch.test',
  LIVEKIT_API_KEY: 'livekit-key-placeholder',
  LIVEKIT_API_SECRET: 'livekit-secret-placeholder',
  GOOGLE_PLAY_PACKAGE_NAME: 'com.vibematch.app',
  GOOGLE_PLAY_PUBSUB_AUDIENCE: 'https://api.vibematch.test/webhooks/google-play/rtdn',
  GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL: 'push@example.iam.gserviceaccount.com',
  OPENAI_API_KEY: 'openai-key-placeholder',
};

const RUNTIME_DATABASE_ENV = [
  'DATABASE_URL_AUTH',
  'DATABASE_URL_PROFILE',
  'DATABASE_URL_MATCHMAKING',
  'DATABASE_URL_MODERATION',
  'DATABASE_URL_VIDEO',
  'DATABASE_URL_BILLING',
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const [name, value] of Object.entries(PROVIDER_ENV)) {
    saved.set(name, process.env[name]);
    process.env[name] = value;
  }
  saved.set('JWT_VERIFICATION_PUBLIC_KEYS_JSON', process.env.JWT_VERIFICATION_PUBLIC_KEYS_JSON);
  delete process.env.JWT_VERIFICATION_PUBLIC_KEYS_JSON;

  for (const name of RUNTIME_DATABASE_ENV) {
    if (!process.env[name]) throw new Error(`Database test requires ${name}`);
  }
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

describe('production runtime readiness', () => {
  test('connects through all six runtime roles and reports ready without owner access', async () => {
    const ownerUrl = process.env.DATABASE_URL_OWNER;
    const migrationUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_OWNER;
    delete process.env.DATABASE_URL;

    const runtime = createProductionRuntime();
    try {
      await expect(runtime.checkReady()).resolves.toBe(true);

      const response = await runtime.app.inject({ method: 'GET', url: '/health/ready' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(response.headers['x-request-id']).toBeDefined();
    } finally {
      await runtime.close();
      if (ownerUrl !== undefined) process.env.DATABASE_URL_OWNER = ownerUrl;
      if (migrationUrl !== undefined) process.env.DATABASE_URL = migrationUrl;
    }
  });
});
