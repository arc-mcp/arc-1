import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local integration-test helper: creates new private credentials, never modifies an ARC app.
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../.secrets/arc-test');
if (existsSync(dir)) throw new Error('Test credentials already exist; preserve/reuse them deliberately');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const key = randomBytes(32).toString('hex');
writeFileSync(resolve(dir, 'mcp-api-key'), key, { mode: 0o600, flag: 'wx' });
writeFileSync(
  resolve(dir, 'environment.json'),
  JSON.stringify({
    var: {
      SAP_TRANSPORT: 'http-streamable',
      ARC1_HTTP_ADDR: '0.0.0.0:8080',
      SAP_SYSTEM_TYPE: 'onprem',
      SAP_BTP_DESTINATION: process.env.GRAPH_TEST_SAP_DESTINATION,
      SAP_ALLOW_WRITES: 'false',
      SAP_ALLOW_FREE_SQL: 'false',
      SAP_ALLOW_DATA_PREVIEW: 'false',
      ARC1_API_KEYS: `${key}:viewer`,
      ARC1_GRAPH_SERVICE_BINDING: process.env.GRAPH_TEST_CONNECTION_BINDING,
      ARC1_GRAPH_TOOLS: 'false',
      ARC1_CACHE: 'memory',
      BP_NODE_VERSION: '22.*',
      OPTIMIZE_MEMORY: 'true',
    },
  }),
  { mode: 0o600, flag: 'wx' },
);
console.log(JSON.stringify({ directory: dir, created: true }));
