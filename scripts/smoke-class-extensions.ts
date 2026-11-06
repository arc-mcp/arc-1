/** Read-only public SAPRead qualification; records hashes/provenance, never source or credentials. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { AdtClient } from '../src/adt/client.js';
import { defaultSafetyConfig } from '../src/adt/safety.js';
import { handleToolCall } from '../src/handlers/dispatch.js';
import { setCachedFeatures } from '../src/handlers/feature-cache.js';
import { DEFAULT_CONFIG } from '../src/server/types.js';

const target = process.env.CLASS_EXTENSION_TARGET;
if (target !== 'a4h' && target !== 'npl') throw new Error('CLASS_EXTENSION_TARGET must be a4h or npl.');
const url = `https://${target}.marianzeis.de`;
if (process.env.SAP_URL !== url) throw new Error('Use the qualified HTTPS 443 target URL.');
const client = new AdtClient({
  baseUrl: url,
  username: process.env.SAP_USER,
  password: process.env.SAP_PASSWORD,
  client: '001',
  language: 'EN',
  insecure: false,
  safety: defaultSafetyConfig(),
});
setCachedFeatures({ abapRelease: target === 'a4h' ? '758' : '750' });
const cases: Record<string, unknown>[] = [
  { type: 'CLAS', name: 'CL_OO_ADT_ENHANCED_CLASS', extensions: 'none' },
  { type: 'CLAS', name: 'CL_OO_ADT_ENHANCED_CLASS' },
  { type: 'CLAS', name: 'CL_OO_ADT_ENHANCED_CLASS', extensions: 'sources' },
  { type: 'CLAS', name: 'CL_SEEF_ADT_TEST_AUNIT_1', extensions: 'none' },
  { type: 'CLAS', name: 'CL_SEEF_ADT_TEST_AUNIT_1', extensions: 'summary' },
  { type: 'CLAS', name: 'CL_SEEF_ADT_TEST_AUNIT_1', extensions: 'sources' },
  { type: 'CLAS', name: 'CL_SEEF_ADT_TEST_AUNIT_1', include: 'definitions', extensions: 'sources' },
  { type: 'INTF', name: 'IF_DSH_ENHANCED_OPTIONS', extensions: 'summary' },
];
const baseline = new Map<string, string>();
const results = [];
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
for (const args of cases) {
  const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', args);
  if (result.isError) {
    results.push({ args, error: true });
    continue;
  }
  const first = result.content[0]?.text ?? '';
  const key = `${args.type}:${args.name}:${args.include ?? 'main'}`;
  if (args.extensions === 'none') baseline.set(key, digest(first));
  if (baseline.has(key)) assert.equal(digest(first), baseline.get(key), 'Base block changed between verified reads.');
  const extra = result.content.slice(1);
  const bytes = extra.reduce((total, block) => total + Buffer.byteLength(block.text), 0);
  assert.ok(bytes <= (args.extensions === 'sources' ? 16384 : 2048));
  if (args.extensions === 'none') assert.equal(extra.length, 0);
  const summary = extra.find((block) => block.text.startsWith('[extensions] '));
  results.push({
    args,
    baseBytes: Buffer.byteLength(first),
    baseSha256: digest(first),
    extraBytes: bytes,
    summary: summary ? JSON.parse(summary.text.slice('[extensions] '.length)) : undefined,
    extraBlocks: extra
      .filter((block) => block !== summary)
      .map((block) => ({
        bytes: Buffer.byteLength(block.text),
        sha256: digest(block.text),
        label: block.text.split('\n')[0],
      })),
  });
}
const json = JSON.stringify({ checkedAt: new Date().toISOString(), target, results }, null, 2);
if (process.env.CLASS_EXTENSION_OUTPUT) writeFileSync(process.env.CLASS_EXTENSION_OUTPUT, `${json}\n`);
process.stdout.write(`${json}\n`);
