import { createServer } from 'node:http';
import { createGraphApi } from './api.js';
import { createGraphStore } from './store/factory.js';

const port = Number.parseInt(process.env.PORT ?? '8091', 10);
if (
  !/^[A-Z0-9][A-Z0-9._:-]{0,127}$/.test(process.env.ARC_GRAPH_API_SYSTEM_KEY ?? '') ||
  !/^[A-Za-z0-9._:-]{1,128}$/.test(process.env.ARC_GRAPH_API_AUDIENCE ?? '')
) {
  throw new Error('Explicit graph API system key and audience are required');
}
const store = await createGraphStore();
const server = createServer(createGraphApi(store));

server.listen(port, '0.0.0.0', () => {
  process.stderr.write(`arc-repository-graph listening on port ${port}\n`);
});

async function shutdown(): Promise<void> {
  server.close();
  await store.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
