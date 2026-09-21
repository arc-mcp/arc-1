import { getHeapStatistics } from 'node:v8';
import { DEFAULT_CONCURRENT_DATA_RESULTS, DEFAULT_DATA_PREVIEW_RESPONSE_BYTES } from '../adt/data-result-context.js';
import { Semaphore } from '../adt/semaphore.js';
import { logger } from './logger.js';
import type { ServerConfig } from './types.js';

/** Exact raw response-body admission envelope, numeric only while it remains a safe integer. */
export function dataResultAdmissionEnvelope(bytesPerResult: number, concurrentResults: number): number | string {
  const exact = BigInt(bytesPerResult) * BigInt(concurrentResults);
  return exact <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : exact.toString();
}

/** Non-secret runtime memory values that let CF operators verify the effective heap policy. */
export function runtimeMemoryEnvelope(
  env: NodeJS.ProcessEnv = process.env,
  heapSizeLimitBytes = getHeapStatistics().heap_size_limit,
): {
  cfMemoryAvailableMiB?: number;
  optimizeMemory: boolean;
  v8HeapSizeLimitMiB: number;
} {
  const memoryAvailable = env.MEMORY_AVAILABLE?.trim();
  const parsedMemoryAvailable = memoryAvailable && /^\d+$/.test(memoryAvailable) ? Number(memoryAvailable) : undefined;
  return {
    cfMemoryAvailableMiB:
      parsedMemoryAvailable !== undefined && Number.isSafeInteger(parsedMemoryAvailable)
        ? parsedMemoryAvailable
        : undefined,
    optimizeMemory: env.OPTIMIZE_MEMORY === 'true',
    v8HeapSizeLimitMiB: Math.round(heapSizeLimitBytes / (1024 * 1024)),
  };
}

/** Construct and report the process-wide data-result admission guard. */
export function createDataResultSemaphore(config: ServerConfig): Semaphore {
  const semaphore = new Semaphore(config.maxConcurrentDataResults);
  const admittedBodyBytes = dataResultAdmissionEnvelope(
    config.maxDataPreviewResponseBytes,
    config.maxConcurrentDataResults,
  );
  logger.info('Data-result safety envelope', {
    maxDataPreviewResponseBytes: config.maxDataPreviewResponseBytes,
    maxConcurrentDataResults: config.maxConcurrentDataResults,
    admittedBodyBytes,
    scope: 'server-wide',
  });
  const defaultEnvelope = BigInt(DEFAULT_DATA_PREVIEW_RESPONSE_BYTES) * BigInt(DEFAULT_CONCURRENT_DATA_RESULTS);
  if (BigInt(config.maxDataPreviewResponseBytes) * BigInt(config.maxConcurrentDataResults) > defaultEnvelope) {
    logger.warn(
      'Configured data-result admission exceeds the shipped 4 MiB envelope. Benchmark bounded peak RSS for this topology and normally reduce ARC1_MAX_CONCURRENT_DATA_RESULTS when raising ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES.',
      {
        maxDataPreviewResponseBytes: config.maxDataPreviewResponseBytes,
        maxConcurrentDataResults: config.maxConcurrentDataResults,
        admittedBodyBytes,
      },
    );
  }
  return semaphore;
}
