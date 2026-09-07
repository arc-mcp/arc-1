import { parentPort, workerData } from 'node:worker_threads';
import { extractGraphObject, SourceParseError } from './extractor.js';

try {
  parentPort?.postMessage({ ok: true, result: extractGraphObject(workerData.object, workerData.catalog) });
} catch (error) {
  // Never send source text, parser exception messages or stacks to the parent/logs.
  parentPort?.postMessage({ ok: false, analysis: error instanceof SourceParseError ? error.analysis : null });
}
