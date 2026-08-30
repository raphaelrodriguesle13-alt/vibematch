import { Pool } from 'pg';
import { GoogleOidcProvider } from '../auth/providers/google';
import { JwtSessionProvider } from '../auth/providers/jwt';
import { PgAuthRateLimiter } from '../auth/rate-limit';
import { registerRefreshRoute } from '../auth/refresh-http';
import { AuthRepository } from '../auth/repository';
import { AuthService } from '../auth/service';
import { env } from '../config/env';
import { buildApp } from '../http/app';
import { registerAgeAssuranceRoutes } from '../profile/age-http';
import { AgeAssuranceRepository } from '../profile/age-assurance-repository';
import { AgeAssuranceService } from '../profile/age-assurance';
import { ProfileRepository } from '../profile/repository';
import { ProfileService } from '../profile/service';

export type AuthOnlyRuntime = {
  app: ReturnType<typeof buildApp>;
  reconcileVideoRevocations(): Promise<{ revoked: number; failed: number }>;
  close(): Promise<void>;
};

export const createAuthOnlyRuntime = (): AuthOnlyRuntime => {
  const pool = new Pool({
    connectionString: env.databaseUrl(),
    connectionTimeoutMillis: env.databaseConnectionTimeoutMs,
  });

  const repository = new AuthRepository(pool);
  const profileService = new ProfileService(new ProfileRepository(pool));
  // Render's auth-only runtime still exposes the authoritative age status from
  // PostgreSQL. No provider is injected here, so starting/refreshing an external
  // verification remains fail-closed until Didit is configured.
  const ageAssuranceService = new AgeAssuranceService(new AgeAssuranceRepository(pool));
  const sessionTokens = new JwtSessionProvider({
    privateKeyPem: env.jwtPrivateKeyPem(),
    publicKeyPem: env.jwtPublicKeyPem(),
    keyId: env.jwtKeyId(),
    verificationPublicKeys: env.jwtVerificationPublicKeys(),
    issuer: env.jwtIssuer(),
    audience: env.jwtAudience(),
  });
  const authService = new AuthService(
    repository,
    new GoogleOidcProvider(env.googleOidcAudience()),
    sessionTokens,
    { sessionTtlSeconds: env.authSessionTtlSeconds },
  );
  const rateLimiter = new PgAuthRateLimiter(pool, {
    windowSeconds: env.authRefreshRateWindowSeconds,
    globalLimit: env.authRefreshGlobalLimit,
    credentialLimit: env.authRefreshCredentialLimit,
  });

  const app = buildApp({
    authService,
    sessionTokenVerifier: sessionTokens,
    activeSessionStore: repository,
    authRateLimiter: rateLimiter,
    phoneStateStore: repository,
    profileService,
    ageAssuranceService,
  });

  registerRefreshRoute(app, { authService, rateLimiter });
  registerAgeAssuranceRoutes(app, {
    service: ageAssuranceService,
    sessionTokenVerifier: sessionTokens,
    activeSessionStore: repository,
  });

  let closed = false;
  return {
    app,
    reconcileVideoRevocations: () => Promise.resolve({ revoked: 0, failed: 0 }),
    close: async () => {
      if (closed) return;
      closed = true;
      await app.close();
      await pool.end();
    },
  };
};
