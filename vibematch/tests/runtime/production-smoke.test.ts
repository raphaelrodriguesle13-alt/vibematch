import { createProductionRuntime } from '../../backend/src/runtime/production';

const RUNTIME_ENV: Readonly<Record<string, string>> = {
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
  DATABASE_URL_AUTH: 'postgres://svc_auth:test@127.0.0.1:1/vibematch',
  DATABASE_URL_PROFILE: 'postgres://svc_profile:test@127.0.0.1:1/vibematch',
  DATABASE_URL_MATCHMAKING: 'postgres://svc_matchmaking:test@127.0.0.1:1/vibematch',
  DATABASE_URL_MODERATION: 'postgres://svc_moderation:test@127.0.0.1:1/vibematch',
  DATABASE_URL_VIDEO: 'postgres://svc_video:test@127.0.0.1:1/vibematch',
  DATABASE_URL_BILLING: 'postgres://svc_billing:test@127.0.0.1:1/vibematch',
};

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const [name, value] of Object.entries(RUNTIME_ENV)) {
    saved.set(name, process.env[name]);
    process.env[name] = value;
  }
  for (const name of ['DATABASE_URL', 'DATABASE_URL_OWNER', 'JWT_VERIFICATION_PUBLIC_KEYS_JSON']) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

describe('production composition root smoke', () => {
  test('constructs health routes and closes without migration-owner credentials or network calls', async () => {
    const runtime = createProductionRuntime();
    try {
      const live = await runtime.app.inject({ method: 'GET', url: '/health/live' });
      expect(live.statusCode).toBe(200);
      expect(live.json()).toEqual({ ok: true });
      expect(live.headers['x-request-id']).toBeDefined();
    } finally {
      await runtime.close();
    }
  });
});
