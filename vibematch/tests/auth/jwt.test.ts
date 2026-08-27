import { generateKeyPair, exportPKCS8, exportSPKI, SignJWT } from 'jose';
import { JwtSessionProvider } from '../../backend/src/auth/providers/jwt';

const makeKeys = async (): Promise<{ privateKeyPem: string; publicKeyPem: string }> => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  return {
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey),
  };
};

describe('JwtSessionProvider', () => {
  test('issues a short-lived RS256 token with an explicit kid', async () => {
    const keys = await makeKeys();
    const provider = new JwtSessionProvider({
      ...keys,
      keyId: '2026-08-primary',
      issuer: 'https://api.vibematch.test',
      audience: 'vibematch-android',
      now: () => new Date('2026-08-27T09:00:00.000Z'),
    });

    const token = await provider.issue(
      { userId: 'user-1', sessionId: 'session-1', phoneVerified: true },
      new Date('2026-08-27T09:15:00.000Z'),
    );
    const header = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')) as {
      alg: string;
      kid?: string;
    };

    expect(header).toMatchObject({ alg: 'RS256', kid: '2026-08-primary' });
    await expect(provider.verify(token)).resolves.toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      phoneVerified: true,
    });
  });

  test('rejects a token signed by an unknown kid even with a trusted key', async () => {
    const keys = await makeKeys();
    const provider = new JwtSessionProvider({
      ...keys,
      keyId: 'primary',
      issuer: 'issuer',
      audience: 'audience',
    });
    const privateKey = await (await import('jose')).importPKCS8(keys.privateKeyPem, 'RS256');
    const token = await new SignJWT({ phone_verified: true })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'retired-or-unknown' })
      .setIssuer('issuer')
      .setAudience('audience')
      .setSubject('user-1')
      .setJti('session-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    await expect(provider.verify(token)).rejects.toThrow('Unknown JWT key id');
  });

  test('rejects issuer and audience mismatches', async () => {
    const keys = await makeKeys();
    const issuer = new JwtSessionProvider({
      ...keys,
      keyId: 'primary',
      issuer: 'issuer-a',
      audience: 'audience-a',
    });
    const verifier = new JwtSessionProvider({
      ...keys,
      keyId: 'primary',
      issuer: 'issuer-b',
      audience: 'audience-b',
    });
    const token = await issuer.issue(
      { userId: 'user-1', sessionId: 'session-1', phoneVerified: false },
      new Date(Date.now() + 60_000),
    );

    await expect(verifier.verify(token)).rejects.toThrow();
  });
});
