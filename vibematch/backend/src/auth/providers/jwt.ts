import { importPKCS8, importSPKI, jwtVerify, SignJWT, type CryptoKey } from 'jose';
import type {
  SessionTokenClaims,
  SessionTokenProvider,
  SessionTokenVerifier,
} from '../../shared/providers';

export interface JwtSessionProviderOptions {
  privateKeyPem: string;
  publicKeyPem: string;
  keyId: string;
  issuer: string;
  audience: string;
  now?: () => Date;
}

export class JwtSessionProvider implements SessionTokenProvider, SessionTokenVerifier {
  private privateKeyPromise: Promise<CryptoKey> | null = null;
  private publicKeyPromise: Promise<CryptoKey> | null = null;
  private readonly now: () => Date;

  constructor(private readonly options: JwtSessionProviderOptions) {
    if (options.privateKeyPem.trim() === '' || options.publicKeyPem.trim() === '') {
      throw new Error('JWT signing key pair is required');
    }
    if (options.keyId.trim() === '') throw new Error('JWT signing key id is required');
    if (options.issuer.trim() === '' || options.audience.trim() === '') {
      throw new Error('JWT issuer and audience are required');
    }
    this.now = options.now ?? (() => new Date());
  }

  async issue(claims: SessionTokenClaims, expiresAt: Date): Promise<string> {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const expiresAtSeconds = Math.floor(expiresAt.getTime() / 1000);
    if (expiresAtSeconds <= nowSeconds) throw new Error('JWT expiry must be in the future');

    return new SignJWT({ phone_verified: claims.phoneVerified })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: this.options.keyId })
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setSubject(claims.userId)
      .setJti(claims.sessionId)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(expiresAtSeconds)
      .sign(await this.privateKey());
  }

  async verify(token: string): Promise<SessionTokenClaims> {
    const { payload, protectedHeader } = await jwtVerify(token, await this.publicKey(), {
      algorithms: ['RS256'],
      issuer: this.options.issuer,
      audience: this.options.audience,
    });

    if (protectedHeader.kid !== this.options.keyId) throw new Error('Unknown JWT key id');
    if (!payload.sub || !payload.jti || typeof payload.phone_verified !== 'boolean') {
      throw new Error('Session JWT is missing required claims');
    }

    return {
      userId: payload.sub,
      sessionId: payload.jti,
      phoneVerified: payload.phone_verified,
    };
  }

  private privateKey(): Promise<CryptoKey> {
    this.privateKeyPromise ??= importPKCS8(this.options.privateKeyPem, 'RS256');
    return this.privateKeyPromise;
  }

  private publicKey(): Promise<CryptoKey> {
    this.publicKeyPromise ??= importSPKI(this.options.publicKeyPem, 'RS256');
    return this.publicKeyPromise;
  }
}
