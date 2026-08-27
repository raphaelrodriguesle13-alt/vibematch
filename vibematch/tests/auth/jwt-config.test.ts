import { env } from '../../backend/src/config/env';

const VARIABLE = 'JWT_VERIFICATION_PUBLIC_KEYS_JSON';
const original = process.env[VARIABLE];

afterEach(() => {
  if (original === undefined) delete process.env[VARIABLE];
  else process.env[VARIABLE] = original;
});

describe('JWT verification keyring configuration', () => {
  test('defaults to an empty verification-only keyring', () => {
    delete process.env[VARIABLE];

    expect(env.jwtVerificationPublicKeys()).toEqual({});
  });

  test('parses previous public keys by kid', () => {
    process.env[VARIABLE] = JSON.stringify({
      '2026-07-retired': '-----BEGIN PUBLIC KEY-----\\nPUBLIC\\n-----END PUBLIC KEY-----',
    });

    expect(env.jwtVerificationPublicKeys()).toEqual({
      '2026-07-retired': '-----BEGIN PUBLIC KEY-----\nPUBLIC\n-----END PUBLIC KEY-----',
    });
  });

  test.each(['not-json', '[]', '"string"', 'null'])('rejects malformed keyring %s', (value) => {
    process.env[VARIABLE] = value;

    expect(() => env.jwtVerificationPublicKeys()).toThrow(
      `Environment variable ${VARIABLE} must be a JSON object`,
    );
  });

  test.each([
    JSON.stringify({ '': 'public-key' }),
    JSON.stringify({ ' padded ': 'public-key' }),
    JSON.stringify({ retired: '' }),
    JSON.stringify({ retired: 123 }),
  ])('rejects invalid kid/public-key mappings', (value) => {
    process.env[VARIABLE] = value;

    expect(() => env.jwtVerificationPublicKeys()).toThrow(
      `Environment variable ${VARIABLE} must map non-empty key ids to public keys`,
    );
  });
});
