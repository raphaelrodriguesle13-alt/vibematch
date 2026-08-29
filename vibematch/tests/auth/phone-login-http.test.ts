import fastify from 'fastify';
import {
  registerPhoneLoginRoutes,
} from '../../backend/src/auth/phone-login-http';
import { PhoneLoginError } from '../../backend/src/auth/phone-login-service';
import type { ProviderLoginResult } from '../../backend/src/auth/provider-service';

const expiresAt = new Date('2026-08-29T14:00:00.000Z');
const result: ProviderLoginResult = {
  sessionJwt: 'signed-jwt',
  refreshToken: 'refresh-token-that-is-long-enough-for-the-test',
  userId: 'user-1',
  isNewUser: true,
  phoneVerified: true,
  sessionId: 'session-1',
  expiresAt: new Date('2026-08-29T13:15:00.000Z'),
  refreshExpiresAt: new Date('2026-09-28T13:00:00.000Z'),
};

class FakePhoneLoginService {
  phone: string | null = null;
  confirmation: { verificationId: string; code: string } | null = null;
  startError: Error | null = null;
  confirmError: Error | null = null;

  start(phone: string): Promise<{ verificationId: string; expiresAt: Date }> {
    this.phone = phone;
    if (this.startError) return Promise.reject(this.startError);
    return Promise.resolve({ verificationId: 'verification-1', expiresAt });
  }

  confirm(verificationId: string, code: string): Promise<ProviderLoginResult> {
    this.confirmation = { verificationId, code };
    if (this.confirmError) return Promise.reject(this.confirmError);
    return Promise.resolve(result);
  }
}

describe('Phone login HTTP API', () => {
  it('starts an anonymous OTP challenge without requiring an access JWT', async () => {
    const app = fastify({ logger: false });
    const service = new FakePhoneLoginService();
    registerPhoneLoginRoutes(app, service);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/phone-login/start',
      payload: { phone_e164: '+5511999999999' },
    });

    expect(response.statusCode).toBe(201);
    expect(service.phone).toBe('+5511999999999');
    expect(response.json()).toEqual({
      verification_id: 'verification-1',
      expires_at: expiresAt.toISOString(),
    });
    await app.close();
  });

  it('rejects malformed start payloads before touching the SMS service', async () => {
    const app = fastify({ logger: false });
    const service = new FakePhoneLoginService();
    registerPhoneLoginRoutes(app, service);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/phone-login/start',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(service.phone).toBeNull();
    await app.close();
  });

  it('maps invalid phone formats to 400', async () => {
    const app = fastify({ logger: false });
    const service = new FakePhoneLoginService();
    service.startError = new PhoneLoginError('INVALID_PHONE', 'invalid');
    registerPhoneLoginRoutes(app, service);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/phone-login/start',
      payload: { phone_e164: '11999999999' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'INVALID_PHONE' });
    await app.close();
  });

  it('returns the common session model after OTP confirmation', async () => {
    const app = fastify({ logger: false });
    const service = new FakePhoneLoginService();
    registerPhoneLoginRoutes(app, service);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/phone-login/confirm',
      payload: { verification_id: 'verification-1', code: '123456' },
    });

    expect(response.statusCode).toBe(200);
    expect(service.confirmation).toEqual({ verificationId: 'verification-1', code: '123456' });
    expect(response.json()).toEqual({
      session_jwt: result.sessionJwt,
      refresh_token: result.refreshToken,
      user_id: result.userId,
      is_new_user: true,
      phone_verified: true,
      expires_at: result.expiresAt.toISOString(),
      refresh_expires_at: result.refreshExpiresAt.toISOString(),
    });
    await app.close();
  });

  it('maps invalid OTPs to 401 and consumed or expired challenges to 410', async () => {
    const app = fastify({ logger: false });
    const service = new FakePhoneLoginService();
    registerPhoneLoginRoutes(app, service);

    service.confirmError = new PhoneLoginError('INVALID_CODE', 'invalid');
    const invalid = await app.inject({
      method: 'POST',
      url: '/auth/phone-login/confirm',
      payload: { verification_id: 'verification-1', code: '000000' },
    });
    expect(invalid.statusCode).toBe(401);

    service.confirmError = new PhoneLoginError('LOGIN_NOT_AVAILABLE', 'expired');
    const expired = await app.inject({
      method: 'POST',
      url: '/auth/phone-login/confirm',
      payload: { verification_id: 'verification-1', code: '123456' },
    });
    expect(expired.statusCode).toBe(410);
    await app.close();
  });
});
