import { spawnSync } from 'node:child_process';

const isRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
if (!isRender) process.exit(0);

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('Render build requires DATABASE_URL before migrations can run.');
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(databaseUrl);
} catch {
  console.error('DATABASE_URL is not a valid PostgreSQL URL. Copy the Internal Database URL from the Render Postgres service.');
  process.exit(1);
}

if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
  console.error('DATABASE_URL must start with postgres:// or postgresql://.');
  process.exit(1);
}

if (!parsed.hostname || parsed.hostname === 'base') {
  console.error('DATABASE_URL has an invalid hostname. In Render, replace it with the Internal Database URL from vibematch-db.');
  process.exit(1);
}

const result = spawnSync('npm', ['run', 'migrate'], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
