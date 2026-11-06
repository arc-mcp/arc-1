/** Read-only qualification using existing A4H fixtures; credentials and full results stay local. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { AdtClient } from '../src/adt/client.js';
import { defaultSafetyConfig } from '../src/adt/safety.js';
import type { parseSyntaxBatch } from '../src/adt/syntax-batch.js';
import type { SyntaxCheckResult } from '../src/adt/types.js';
import { handleToolCall } from '../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../src/server/types.js';

config({ quiet: true, path: process.env.DOTENV_CONFIG_PATH ?? '.env' });
const configured = new URL(process.env.TEST_SAP_URL || process.env.SAP_URL || 'https://unconfigured.invalid');
const username = process.env.TEST_SAP_USER || process.env.SAP_USER;
const password = process.env.TEST_SAP_PASSWORD || process.env.SAP_PASSWORD;
const output = process.argv[2];
if (
  configured.hostname !== 'a4h.marianzeis.de' ||
  (process.env.TEST_SAP_CLIENT || process.env.SAP_CLIENT) !== '001' ||
  !username ||
  !password ||
  !output
)
  throw new Error('Requires existing A4H/001 credentials and a new private output directory.');
mkdirSync(output, { mode: 0o700 });
const client = new AdtClient({
  baseUrl: 'https://a4h.marianzeis.de',
  client: '001',
  username,
  password,
  insecure: false,
  safety: defaultSafetyConfig(),
});
const objects = [
  { type: 'CLAS', name: 'ZCL_ARC1_TD_CALC' },
  { type: 'PROG', name: 'ZARC1_TD_REPORT' },
  { type: 'INTF', name: 'ZIF_ARC1_TD_SHAPE' },
  { type: 'DDLS', name: 'ZARC1_TD_VIEW' },
];
let requests = 0;
const post = client.http.post.bind(client.http);
client.http.post = async (...args) => {
  if (args[0] !== '/sap/bc/adt/checkruns') throw new Error('Probe refuses every non-check POST.');
  requests++;
  return post(...args);
};
let serial = 0;
async function call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
  const result = await handleToolCall(client, { ...DEFAULT_CONFIG, systemType: 'onprem' }, tool, args, {
    token: 'local-read-only-probe',
    clientId: 'syntax-research',
    scopes: ['read'],
  });
  const text = result.content.map((item) => item.text ?? '').join('\n');
  writeFileSync(join(output, `${++serial}.json`), text, { flag: 'wx', mode: 0o600 });
  if (result.isError) throw new Error('Syntax call failed; inspect the private result.');
  return JSON.parse(text) as T;
}
type Batch = ReturnType<typeof parseSyntaxBatch>;
const active = await call<Batch>('SAPDiagnose', { action: 'syntax', objects, version: 'active' });
const inactive = await call<Batch>('SAPDiagnose', { action: 'syntax', objects, version: 'inactive' });
const absent = await call<Batch>('SAPDiagnose', {
  action: 'syntax',
  objects: [objects[0], { type: 'PROG', name: 'ZARC1_NO_SUCH_BATCH_1011' }],
});
const singles: Array<{
  type: string;
  name: string;
  checked: boolean;
  hasErrors: boolean;
  messages: SyntaxCheckResult['messages'];
}> = [];
for (const object of objects) {
  const result = await call<SyntaxCheckResult>('SAPRead', {
    type: 'SYNTAX',
    objectType: object.type,
    name: object.name,
    version: 'active',
  });
  singles.push({ ...object, checked: result.checked, hasErrors: result.hasErrors, messages: result.messages });
}
const comparable = active.results.map((result) => ({
  type: result.type,
  name: result.name,
  checked: result.checked,
  hasErrors: result.hasErrors,
  messages: result.messages,
}));
const summary = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  at: new Date().toISOString(),
  target: 'A4H/001',
  url: 'https://a4h.marianzeis.de',
  route: 'local real dispatcher, existing Basic identity',
  release: '758 SP02 previously recorded; not re-probed',
  syntaxRequests: requests,
  mutations: 0,
  activeMatchesSingles: JSON.stringify(comparable) === JSON.stringify(singles),
  absentNotPassed: absent.results.length === 2 && ['failed', 'not-checked'].includes(absent.results[1].status),
  cases: [active, inactive, absent].map((result, index) => ({
    label: ['active', 'inactive', 'absent'][index],
    status: result.status,
    checkedObjectCount: result.checkedObjectCount,
    sha256: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
    objects: result.results.map((object) => ({
      type: object.type,
      name: object.name,
      status: object.status,
      checked: object.checked,
      hasErrors: object.hasErrors,
      messages: object.messages.length,
    })),
  })),
};
writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(summary));
if (!summary.activeMatchesSingles || !summary.absentNotPassed || active.checkedObjectCount !== 4) process.exitCode = 1;
