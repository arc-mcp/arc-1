import type { Server as HttpServer } from 'node:http';
import { logger } from './logger.js';

const SHUTDOWN_TIMEOUT_MS = 5_000;

/** Stop accepting HTTP requests and let active responses finish before flushing audit events. */
export function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

/** Signals suppress Node's default exit, so explicitly exit after bounded, once-only cleanup. */
export function registerShutdownHandlers(stopTransports: () => Promise<void>, closeCache: () => void): () => void {
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`ARC-1 shutting down (${signal})`);
    // Keep the timer referenced: even a stalled sink with no open socket must get a chance to flush.
    const timeout = setTimeout(() => {
      logger.warn('Shutdown timed out; pending requests or audit writes may be lost');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      try {
        await stopTransports();
      } catch {
        logger.warn('Failed to close server transports during shutdown');
      }
      await logger.flush();
    } catch {
      logger.warn('Failed to flush audit sinks during shutdown');
    } finally {
      try {
        closeCache();
      } catch {
        // best-effort-cleanup: cache errors must not prevent process exit.
      }
      clearTimeout(timeout);
      process.exit(0);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return () => {
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
  };
}
