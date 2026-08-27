import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, SignJWT } from 'jose';
import { JwtSessionProvider } from '../../backend/src/auth/providers/jwt';

const NOW = new Date('2026-08-27T09:00:00.000Z');
const EXPIRES_AT = new Date('2026-08-27T09:15:00.000Z');

const makeKeys = async (): Promise<{ privateKeyPem: string; publicKeyPem: string }> => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  return {
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey),
  };
};

const providerFor = (
  keys: { privateKeyPem: string; publicKeyPem: string },
  keyId: string,
  verificationPublicKeys?: Readonly<Record<string, string>>,
): JwtSessionProvider =>
  new JwtSessionProvider({
    ...keys,
    keyId,
    ...(verificationPublicKeys === undefined ? {} : { verificationPublicKeys }),
    issuer: 'https://api.vibematch.test',
    audience: 'vibematch-android',
    now: () => NOW,
  });

const claims = { userId: 'user-1', sessionId: 'session-1', phoneVerified: true };

describe('JwtSessionProvider', () => {
  test('issues a short-lived RS256 token with an explicit active kid', async () => {
    const keys = await makeKeys();
    const provider = providerFor(keys, '2026-08-primary');

    const token = await provider.issue(claims, EXPIRES_AT);
    const header = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')) as {
      alg: string;
      kid?: string;
    };

    expect(header).toMatchObject({ alg: 'RS256', kid: '2026-08-primary' });
    await expect(provider.verify(token)).resolves.toEqual(claims);
  });

  test('accepts a previous public key during a controlled rotation window', async () => {
    const oldKeys = await makeKeys();
    const newKeys = await makeKeys();
    const oldProvider = providerFor(oldKeys, '2026-07-retired');
    const rotatedProvider = providerFor(newKeys, '2026-08-primary', {
      '2026-07-retired': oldKeys.publicKeyPem,
    });

    const oldToken = await oldProvider.issue(claims, EXPIRES_AT);

    await expect(rotatedProvider.verify(oldToken)).resolves.toEqual(claims);
  });

  test('rejects a retired key after it is removed from the verification keyring', async () => {
    const oldKeys = await makeKeys();
    const newKeys = await makeKeys();
    const oldToken = await providerFor(oldKeys, '2026-07-retired').issue(claims, EXPIRES_AT);

    await expect(providerFor(newKeys, '2026-08-primary').verify(oldToken)).rejects.toThrow(
      'Unknown JWT key id',
    );
  });

  test('rejects a token whose trusted kid is signed by a different key', async () => {
    const activeKeys = await makeKeys();
    const attackerKeys = await makeKeys();
    const provider = providerFor(activeKeys, 'primary');
    const attackerPrivateKey = await importPKCS8(attackerKeys.privateKeyPem, 'RS256');
    const forged = await new SignJWT({ phone_verified: true })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'primary' })
      .setIssuer('https://api.vibematch.test')
      .setAudience('vibematch-android')
      .setSubject('user-1')
      .setJti('session-1')
      .setIssuedAt(Math.floor(NOW.getTime() / 1000))
      .setExpirationTime(Math.floor(EXPIRES_AT.getTime() / 1000))
      .sign(attackerPrivateKey);

    await expect(provider.verify(forged)).rejects.toThrow();
  });

  test('rejects unknown and missing kid before authorization claims are trusted', async () => {
    const keys = await makeKeys();
    const provider = providerFor(keys, 'primary');
    const privateKey = await importPKCS8(keys.privateKeyPem, 'RS256');
    const base = new SignJWT({ phone_verified: true })
      .setIssuer('https://api.vibematch.test')
      .setAudience('vibematch-android')
      .setSubject('user-1')
      .setJti('session-1')
      .setIssuedAt(Math.floor(NOW.getTime() / 1000))
      .setExpirationTime(Math.floor(EXPIRES_AT.getTime() / 1000));
    const unknownKid = await base
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'unknown' })
      .sign(privateKey);
    const missingKid = await new SignJWT({ phone_verified: true })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer('https://api.vibematch.test')
      .setAudience('vibematch-android')
      .setSubject('user-1')
      .setJti('session-1')
      .setIssuedAt(Math.floor(NOW.getTime() / 1000))
      .setExpirationTime(Math.floor(EXPIRES_AT.getTime() / 1000))
      .sign(privateKey);

    await expect(provider.verify(unknownKid)).rejects.toThrow('Unknown JWT key id');
    await expect(provider.verify(missingKid)).rejects.toThrow('Session JWT is missing key id');
  });

  test('rejects issuer and audience mismatches', async () => {
    const keys = await makeKeys();
    const issuer = providerFor(keys, 'primary');
    const verifier = new JwtSessionProvider({
      ...keys,
      keyId: 'primary',
      issuer: 'https://other-issuer.test',
      audience: 'other-audience',
      now: () => NOW,
    });
    const token = await issuer.issue(claims, EXPIRES_AT);

    await expect(verifier.verify(token)).rejects.toThrow();
  });

  test('rejects duplicate active kid in the verification-only keyring', async () => {
    const keys = await makeKeys();

    expect(
      () =>
        new JwtSessionProvider({
          ...keys,
          keyId: 'primary',
          verificationPublicKeys: { primary: keys.publicKeyPem },
          issuer: 'issuer',
          audience: 'audience',
        }),
    ).toThrow('JWT active key id must not be repeated in verification keyring');
  });
});
