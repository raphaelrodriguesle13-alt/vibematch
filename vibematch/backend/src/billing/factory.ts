import { Pool } from 'pg';
import { env } from '../config/env';
import { BillingRepository } from './repository';
import { BillingService } from './service';
import { GooglePlaySubscriptionVerifierImpl } from './google-play';
import { PubSubPushVerifier } from './rtdn';

export type BillingRuntime = {
  service: BillingService;
  rtdnVerifier: PubSubPushVerifier;
  packageName: string;
  close(): Promise<void>;
};

export const createBillingRuntime = (): BillingRuntime => {
  const pool = new Pool({ connectionString: env.billingDatabaseUrl() });
  const repository = new BillingRepository(pool);
  const packageName = env.googlePlayPackageName();
  const verifier = new GooglePlaySubscriptionVerifierImpl({
    packageName,
    apiBaseUrl: env.googlePlayApiBaseUrl,
  });
  const service = new BillingService(repository, verifier);
  const rtdnVerifier = new PubSubPushVerifier({
    audience: env.googlePlayPubSubAudience(),
    expectedServiceAccountEmail: env.googlePlayPubSubServiceAccountEmail(),
  });

  return {
    service,
    rtdnVerifier,
    packageName,
    close: async () => pool.end(),
  };
};
