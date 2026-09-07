import { Worker } from 'node:worker_threads';
import type { extractGraphObject } from './extractor.js';
import { SourceParseError } from './extractor.js';

/** A hung or exhausted parser is terminated; its last-good graph evidence stays intact. */
export async function extractBounded(
  object: Parameters<typeof extractGraphObject>[0],
  catalog: Parameters<typeof extractGraphObject>[1],
  timeoutMs = 5000,
): Promise<ReturnType<typeof extractGraphObject>> {
  if (Buffer.byteLength(object.source) > 1_048_576) throw new Error('source_too_large');
  const worker = new Worker(new URL('../../dist/collector/parser-worker.js', import.meta.url), {
    workerData: { object, catalog },
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
    stdout: true,
    stderr: true,
  });
  // Discard any accidental dependency output; it could contain source.
  worker.stdout.resume();
  worker.stderr.resume();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('parser_timeout')), timeoutMs);
      worker.once('error', () => reject(new Error('parser_failed')));
      worker.once('exit', () => reject(new Error('parser_exited')));
      worker.once('message', (message) => {
        if (message.ok) resolve(message.result);
        else if (message.analysis) reject(new SourceParseError(message.analysis));
        else reject(new Error('parser_failed'));
      });
    });
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}
