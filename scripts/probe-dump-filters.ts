/** Read-only positive-match probe. Credentials stay local; only aggregate evidence is printed. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { AdtClient } from '../src/adt/client.js';
import { defaultSafetyConfig } from '../src/adt/safety.js';
import type { DumpEntry } from '../src/adt/types.js';
import { handleToolCall } from '../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../src/server/types.js';

config({ quiet: true, path: process.env.DOTENV_CONFIG_PATH ?? '.env' });
const configured = new URL(process.env.TEST_SAP_URL || process.env.SAP_URL || 'https://unconfigured.invalid');
const sapClient = process.env.TEST_SAP_CLIENT || process.env.SAP_CLIENT;
const username = process.env.TEST_SAP_USER || process.env.SAP_USER;
const password = process.env.TEST_SAP_PASSWORD || process.env.SAP_PASSWORD;
const output = process.argv[2];
if (configured.hostname !== 'a4h.marianzeis.de' || sapClient !== '001' || !username || !password || !output)
  throw new Error('Requires existing A4H/001 credentials and a new private output directory.');
mkdirSync(output, { mode: 0o700 });
// Repository instructions require nginx HTTPS, regardless of legacy local .env port settings.
const client = new AdtClient({
  baseUrl: 'https://a4h.marianzeis.de',
  client: '001',
  username,
  password,
  insecure: false,
  safety: defaultSafetyConfig(),
});
const requests: Array<{ status: number; bytes: number; sha256: string }> = [];
const get = client.http.get.bind(client.http);
client.http.get = async (...args) => {
  const response = await get(...args);
  requests.push({
    status: response.statusCode,
    bytes: Buffer.byteLength(response.body),
    sha256: createHash('sha256').update(response.body).digest('hex'),
  });
  return response;
};
const to = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
let serial = 0;
async function call(args: Record<string, unknown>): Promise<DumpEntry[]> {
  const result = await handleToolCall(client, { ...DEFAULT_CONFIG, systemType: 'onprem' }, 'SAPDiagnose', args, {
    token: 'local-read-only-probe',
    clientId: 'diagnostic-research',
    scopes: ['read'],
  });
  const text = result.content.map((c) => c.text ?? '').join('\n');
  writeFileSync(join(output, `${++serial}.json`), text, { flag: 'wx', mode: 0o600 });
  if (result.isError) throw new Error('Diagnostic call failed; inspect the private result.');
  return JSON.parse(text) as DumpEntry[];
}
const recent = await call({ action: 'dumps', maxResults: 1, to });
if (!recent.length) throw new Error('No existing dump to establish a positive match; no incident will be generated.');
const wanted = recent[0]!;
const match = await call({
  action: 'dumps',
  maxResults: 1,
  to,
  filters: [{ attribute: 'runtimeError', operator: 'equals', values: [wanted.error] }],
});
const absent = await call({
  action: 'dumps',
  maxResults: 1,
  to,
  filters: [{ attribute: 'runtimeError', operator: 'equals', values: ['ARC1_RESEARCH_NO_SUCH_ERROR'] }],
});
const summary = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  target: 'A4H/001',
  url: 'https://a4h.marianzeis.de',
  route: 'local real dispatcher, existing Basic identity',
  source: 'independent dump-filter extraction from main 498c12bb',
  release: '758 SP02 in earlier recorded probe; release not queried again in this bounded match probe',
  mutationCalls: 0,
  maxRowsPerCall: 1,
  boundedTo: to,
  positiveMatchedSameIdAndError: match.length === 1 && match[0]!.id === wanted.id && match[0]!.error === wanted.error,
  negativeEmpty: absent.length === 0,
  requests,
};
writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(summary));
if (!summary.positiveMatchedSameIdAndError || !summary.negativeEmpty) process.exitCode = 1;
