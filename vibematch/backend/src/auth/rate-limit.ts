import { createHash } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

export type AuthRateLimitScope =
  | 'GOOGLE_LOGIN'
  | 'PHONE_START'
  | 'PHONE_CONFIRM'
  | 'REFRESH'
  | 'LOGOUT_REFRESH';

export type AuthRateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export interface AuthRateLimiter {
  consume(
    scope: AuthRateLimitScope,
    keyMaterial: string | null,
    now: Date,
  ): Promise<AuthRateLimitDecision>;
}

type CountRow = QueryResultRow & { request_count: number };

export type PgAuthRateLimiterOptions = {
  windowSeconds: number;
  globalLimit: number;
  credentialLimit: number;
};

const positiveInteger = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};

const fingerprint = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const windowStart = (now: Date, windowSeconds: number): Date => {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
};

export class PgAuthRateLimiter implements AuthRateLimiter {
  private readonly windowSeconds: number;
  private readonly globalLimit: number;
  private readonly credentialLimit: number;

  constructor(
    private readonly pool: Pool,
    options: PgAuthRateLimiterOptions,
  ) {
    this.windowSeconds = positiveInteger('windowSeconds', options.windowSeconds);
    this.globalLimit = positiveInteger('globalLimit', options.globalLimit);
    this.credentialLimit = positiveInteger('credentialLimit', options.credentialLimit);
  }

  async consume(
    scope: AuthRateLimitScope,
    keyMaterial: string | null,
    now: Date,
  ): Promise<AuthRateLimitDecision> {
    const start = windowStart(now, this.windowSeconds);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((start.getTime() + this.windowSeconds * 1000 - now.getTime()) / 1000),
    );

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.pruneOldWindows(client, start);
      const globalCount = await this.increment(client, scope, 'GLOBAL', start);
      let allowed = globalCount <= this.globalLimit;

      // Once the global ceiling is exceeded, do not create attacker-controlled
      // per-key rows. This bounds table cardinality during credential spray.
      if (allowed && keyMaterial) {
        const keyCount = await this.increment(client, scope, fingerprint(keyMaterial), start);
        allowed = keyCount <= this.credentialLimit;
      }

      await client.query('COMMIT');
      return { allowed, retryAfterSeconds };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async pruneOldWindows(client: PoolClient, currentWindow: Date): Promise<void> {
    const retentionMs = this.windowSeconds * 2 * 1000;
    await client.query(`DELETE FROM auth_rate_limits WHERE window_started_at < $1`, [
      new Date(currentWindow.getTime() - retentionMs),
    ]);
  }

  private async increment(
    client: PoolClient,
    scope: AuthRateLimitScope,
    keyHash: string,
    start: Date,
  ): Promise<number> {
    const result = await client.query<CountRow>(
      `INSERT INTO auth_rate_limits (scope, key_hash, window_started_at, request_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (scope, key_hash, window_started_at)
       DO UPDATE SET request_count = auth_rate_limits.request_count + 1
       RETURNING request_count`,
      [scope, keyHash, start],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Auth rate limit counter was not persisted');
    return row.request_count;
  }
}
