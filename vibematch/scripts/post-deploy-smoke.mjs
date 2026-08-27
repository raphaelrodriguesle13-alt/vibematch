const baseUrlRaw = process.env.BASE_URL?.trim();
if (!baseUrlRaw) {
  throw new Error('BASE_URL is required');
}

const baseUrl = new URL(baseUrlRaw);
const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname);
if (baseUrl.protocol !== 'https:' && !(isLocalhost && baseUrl.protocol === 'http:')) {
  throw new Error('BASE_URL must use HTTPS (HTTP is allowed only for localhost)');
}

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

const probe = async (path) => {
  const url = new URL(path, baseUrl);
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });

  const requestId = response.headers.get('x-request-id');
  if (!requestId || !requestIdPattern.test(requestId)) {
    throw new Error(`${path} did not return a valid x-request-id`);
  }
  if (response.status !== 200) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${path} did not return valid JSON`);
  }
  if (body?.ok !== true) {
    throw new Error(`${path} did not report ok=true`);
  }

  process.stdout.write(
    `${JSON.stringify({ event: 'post_deploy_probe.passed', path, status_code: 200, request_id: requestId })}\n`,
  );
};

await probe('/health/live');
await probe('/health/ready');
process.stdout.write(`${JSON.stringify({ event: 'post_deploy_smoke.passed' })}\n`);
