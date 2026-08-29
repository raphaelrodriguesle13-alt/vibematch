import { jest } from '@jest/globals';
import { MetaFacebookIdentityProvider } from '../../backend/src/auth/providers/facebook';

const appId = '1234567890';
const appSecret = 'server-only-test-secret';
const now = new Date('2026-08-29T13:00:00.000Z');

const response = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const providerWith = (payload: unknown, status = 200) => {
  const fetchImpl = jest.fn(() =>
    Promise.resolve(response(payload, status)),
  ) as unknown as typeof fetch;
  const provider = new MetaFacebookIdentityProvider({
    appId,
    appSecret,
    fetchImpl,
    now: () => now,
  });
  return { provider, fetchImpl };
};

describe('MetaFacebookIdentityProvider', () => {
  it('accepts only a valid unexpired token issued for the configured app', async () => {
    const { provider, fetchImpl } = providerWith({
      data: {
        app_id: appId,
        is_valid: true,
        user_id: 'facebook-user-123',
        expires_at: Math.floor(now.getTime() / 1000) + 3600,
      },
    });

    await expect(provider.verifyAccessToken('user-access-token')).resolves.toEqual({
      subject: 'facebook-user-123',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a token issued for a different Meta app', async () => {
    const { provider } = providerWith({
      data: {
        app_id: 'different-app',
        is_valid: true,
        user_id: 'facebook-user-123',
        expires_at: Math.floor(now.getTime() / 1000) + 3600,
      },
    });

    await expect(provider.verifyAccessToken('user-access-token')).rejects.toThrow(
      'invalid for this app',
    );
  });

  it('rejects expired access tokens', async () => {
    const { provider } = providerWith({
      data: {
        app_id: appId,
        is_valid: true,
        user_id: 'facebook-user-123',
        expires_at: Math.floor(now.getTime() / 1000) - 1,
      },
    });

    await expect(provider.verifyAccessToken('user-access-token')).rejects.toThrow('expired');
  });

  it('fails closed when the Meta validation endpoint is unavailable', async () => {
    const { provider } = providerWith({ error: 'unavailable' }, 503);

    await expect(provider.verifyAccessToken('user-access-token')).rejects.toThrow(
      'validation failed with 503',
    );
  });
});
