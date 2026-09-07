import { collectLiveGraph } from '../collector/live-collector.js';
import { HanaGraphStore } from './store/hana.js';

export async function runHanaCli(command: string | undefined): Promise<void> {
  if (process.env.ARC_GRAPH_HANA_BOOTSTRAP === 'true') throw new Error('Bootstrap credentials cannot collect');
  const store = new HanaGraphStore();
  try {
    if (command === 'collect-live-metadata' || command === 'collect-live-source') {
      const result = await store.withCollectionLease(process.env.ARC_GRAPH_SYSTEM_KEY ?? '', (leased) =>
        collectLiveGraph(leased, command === 'collect-live-source' ? 'transient-source' : 'metadata'),
      );
      process.stdout.write(`${JSON.stringify({ status: 'ok', ...result })}\n`);
    } else if (command === 'doctor') {
      process.stdout.write(`${JSON.stringify({ status: 'ok', backend: 'hana', ...(await store.ready()) })}\n`);
    } else {
      throw new Error('HANA supports doctor and live collection; use the dedicated bootstrap task for migrations');
    }
  } finally {
    await store.close();
  }
}
