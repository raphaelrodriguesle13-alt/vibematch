import { env } from './config/env';
import { consoleStructuredLogger } from './http/observability';
import { createProductionRuntime } from './runtime/production';

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : 'UnknownError';

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
        consoleStructuredLogger.error({
          event: 'video.revocation.reconciliation.incomplete',
          revoked: result.revoked,
          failed: result.failed,
        });
      }
    } catch (error) {
      consoleStructuredLogger.error({
        event: 'video.revocation.reconciliation.failed',
        error_name: errorName(error),
      });
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
    consoleStructuredLogger.info({ event: 'backend.shutdown.started', signal });
    try {
      await runtime.close();
      process.exitCode = 0;
      consoleStructuredLogger.info({ event: 'backend.shutdown.completed', signal });
    } catch (error) {
      consoleStructuredLogger.error({
        event: 'backend.shutdown.failed',
        signal,
        error_name: errorName(error),
      });
      process.exitCode = 1;
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  try {
    await runtime.app.listen({ host: env.host, port: env.port });
    consoleStructuredLogger.info({ event: 'backend.started', host: env.host, port: env.port });
    await reconcile();
  } catch (error) {
    consoleStructuredLogger.error({
      event: 'backend.startup.failed',
      error_name: errorName(error),
    });
    await shutdown('STARTUP_FAILURE');
  }
};

void main();
