import { spawnSync } from 'node:child_process';

const isRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
if (!isRender) process.exit(0);

if (!process.env.DATABASE_URL?.trim()) {
  console.error('Render build requires DATABASE_URL before migrations can run.');
  process.exit(1);
}

const result = spawnSync('npm', ['run', 'migrate'], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
