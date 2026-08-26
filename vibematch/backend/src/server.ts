import { env } from './config/env';
import { createProductionRuntime } from './runtime/production';

const main = async (): Promise<void> => {
  const runtime = createProductionRuntime();
  let shuttingDown = false;
  let reconciling = false;

  const reconcile = async (): Promise<void> => {
    if (reconciling || shuttingDown) return;
    reconciling = true;
    try {
      const result = await runtime.reconcileVideoRevocations();
      if (result.failed > 0) {
        console.error('video revocation reconciliation incomplete', result);
      }
    } catch (error) {
      console.error('video revocation reconciliation failed', error);
    } finally {
      reconciling = false;
    }
  };

  const timer = setInterval(() => {
    void reconcile();
  }, env.videoRevocationIntervalMs);
  timer.unref();

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    try {
      await runtime.close();
      process.exitCode = 0;
    } catch (error) {
      console.error(`backend shutdown failed after ${signal}`, error);
      process.exitCode = 1;
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  try {
    await runtime.app.listen({ host: env.host, port: env.port });
    await reconcile();
  } catch (error) {
    console.error('backend startup failed', error);
    await shutdown('STARTUP_FAILURE');
  }
};

void main();
