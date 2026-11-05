/** Fixed fresh seven-owner RAP/document lifecycle; shared source-bound claim and JPEG prerequisite phases. */
import { readFixedCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { isDirectEntry } from './native-declarative-entry.js';
import { RAP_DOCUMENT_PROTOCOL, RAP_DOCUMENT_STAGES, rapDocumentFixtures } from './native-rap-documents-fixtures.js';
import type { RapFixture } from './native-rap-fixtures.js';
export function runNativeRapDocumentPhases(args: string[], dependencies?: DdicPhaseDependencies<RapFixture>) {
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: RAP_DOCUMENT_PROTOCOL,
      flag: 'rap-documents-v1',
      suffixBytes: 6,
      stages: RAP_DOCUMENT_STAGES,
      failureGraph: 'fixed-managed-rap-document-pool-service-binding-graph',
      fixtures: rapDocumentFixtures,
      deletedOwners: (f) => [...f].reverse().map((v) => v.owner),
      intent: (binding) => readFixedCollectionsIntent(binding, RAP_DOCUMENT_PROTOCOL, rapDocumentFixtures),
      helpers: async () => {
        const h = await import('./native-rap-runner.js');
        return { runtime: h.rapDocumentRuntime, client: h.rapClient, preflight: h.rapGetOnlyPreflight };
      },
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeRapDocumentPhases(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fixed RAP/document qualification stopped; preserve every claim and residual. Never replay.');
    process.exitCode = 1;
  }
}
