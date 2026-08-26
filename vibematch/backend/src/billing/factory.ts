import { Pool } from 'pg';
import { env } from '../config/env';
import { BillingRepository } from './repository';
import { BillingService } from './service';
import { GooglePlaySubscriptionVerifierImpl } from './google-play';

export type BillingRuntime = {
  service: BillingService;
  close(): Promise<void>;
};

export const createBillingRuntime = (): BillingRuntime => {
  const pool = new Pool({ connectionString: env.billingDatabaseUrl() });
  const repository = new BillingRepository(pool);
  const verifier = new GooglePlaySubscriptionVerifierImpl({
    packageName: env.googlePlayPackageName(),
    apiBaseUrl: env.googlePlayApiBaseUrl,
  });
  const service = new BillingService(repository, verifier);

  return {
    service,
    close: async () => pool.end(),
  };
};
