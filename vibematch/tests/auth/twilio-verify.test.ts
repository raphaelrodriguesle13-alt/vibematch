import { jest } from '@jest/globals';
import { TwilioVerifyProvider } from '../../backend/src/auth/providers/twilio-verify';

const response = (payload: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: async () => payload }) as Response;

describe('TwilioVerifyProvider', () => {
  test('starts SMS verification without exposing provider credentials to the caller', async () => {
    const fetchImpl: typeof fetch = jest.fn(async () =>
      response({ sid: 'VE1234567890abcdef1234567890abcdef' }),
    );
    const provider = new TwilioVerifyProvider({
      accountSid: 'AC123',
      authToken: 'server-secret',
      serviceSid: 'VA123',
      fetchImpl,
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    });

    await expect(provider.start('user-1', '+5511999999999')).resolves.toEqual({
      providerVerificationId: 'VE1234567890abcdef1234567890abcdef',
      expiresAt: new Date('2026-08-26T00:10:00.000Z'),
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://verify.twilio.com/v2/Services/VA123/Verifications',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('accepts a code only when Twilio returns approved', async () => {
    const fetchImpl: typeof fetch = jest.fn(async () => response({ status: 'approved' }));
    const provider = new TwilioVerifyProvider({
      accountSid: 'AC123',
      authToken: 'server-secret',
      serviceSid: 'VA123',
      fetchImpl,
    });

    await expect(provider.confirm('VE123', '123456')).resolves.toBe(true);
  });

  test('fails closed on provider HTTP errors', async () => {
    const fetchImpl: typeof fetch = jest.fn(async () => response(null, false, 503));
    const provider = new TwilioVerifyProvider({
      accountSid: 'AC123',
      authToken: 'server-secret',
      serviceSid: 'VA123',
      fetchImpl,
    });

    await expect(provider.start('user-1', '+5511999999999')).rejects.toThrow(
      'Twilio Verify request failed',
    );
  });
});
