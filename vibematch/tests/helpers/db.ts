import { Pool, PoolClient } from 'pg';

type RuntimeRole =
  'svc_auth' | 'svc_profile' | 'svc_matchmaking' | 'svc_video' | 'svc_moderation' | 'svc_billing';

type IdRow = { id: string };

/**
 * Conexões de teste. Todas as credenciais vêm do ambiente — nunca hardcoded.
 * Ver .env.example para as variáveis esperadas.
 */
const url = (v: string | undefined, name: string): string => {
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
};

export const ownerPool = new Pool({
  connectionString: url(process.env.DATABASE_URL_OWNER, 'DATABASE_URL_OWNER'),
});

export const rolePools: Record<RuntimeRole, Pool> = {
  svc_auth: new Pool({
    connectionString: url(process.env.DATABASE_URL_AUTH, 'DATABASE_URL_AUTH'),
  }),
  svc_profile: new Pool({
    connectionString: url(process.env.DATABASE_URL_PROFILE, 'DATABASE_URL_PROFILE'),
  }),
  svc_matchmaking: new Pool({
    connectionString: url(process.env.DATABASE_URL_MATCHMAKING, 'DATABASE_URL_MATCHMAKING'),
  }),
  svc_video: new Pool({
    connectionString: url(process.env.DATABASE_URL_VIDEO, 'DATABASE_URL_VIDEO'),
  }),
  svc_moderation: new Pool({
    connectionString: url(process.env.DATABASE_URL_MODERATION, 'DATABASE_URL_MODERATION'),
  }),
  svc_billing: new Pool({
    connectionString: url(process.env.DATABASE_URL_BILLING, 'DATABASE_URL_BILLING'),
  }),
};

/** Executa fn e devolve o erro do PostgreSQL, ou null se não houve erro. */
export async function expectDbError(
  pool: Pool,
  sql: string,
  params: unknown[] = [],
): Promise<{ code?: string; message: string } | null> {
  try {
    await pool.query(sql, params);
    return null;
  } catch (e) {
    const err = e as { code?: string; message: string };
    const result: { code?: string; message: string } = { message: err.message };
    if (err.code !== undefined) result.code = err.code;
    return result;
  }
}

export async function withRollback<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** Cria dois usuários ACTIVE, phone_verified e APPROVED, com MatchIntent ACCEPTED. */
export async function seedAcceptedIntent(client: PoolClient): Promise<{
  userA: string;
  userB: string;
  intentId: string;
}> {
  const a = await client.query<IdRow>(
    `INSERT INTO users (google_subject_id, phone_verified, age_assurance_status)
     VALUES ($1, TRUE, 'APPROVED') RETURNING id`,
    [`sub-a-${Math.random()}`],
  );
  const b = await client.query<IdRow>(
    `INSERT INTO users (google_subject_id, phone_verified, age_assurance_status)
     VALUES ($1, TRUE, 'APPROVED') RETURNING id`,
    [`sub-b-${Math.random()}`],
  );

  const userA = a.rows[0]?.id;
  const userB = b.rows[0]?.id;
  if (!userA || !userB) throw new Error('Failed to seed users');

  const intent = await client.query<IdRow>(
    `INSERT INTO match_intents (sender_id, receiver_id, status, expires_at, responded_at)
     VALUES ($1,$2,'ACCEPTED', now() + interval '1 day', now()) RETURNING id`,
    [userA, userB],
  );
  const intentId = intent.rows[0]?.id;
  if (!intentId) throw new Error('Failed to seed accepted match intent');

  return { userA, userB, intentId };
}

export async function closeAll(): Promise<void> {
  await ownerPool.end();
  await Promise.all(Object.values(rolePools).map((p) => p.end()));
}
