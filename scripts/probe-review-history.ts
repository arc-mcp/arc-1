/** Read-only follow-up to the eight-request pilot. Never creates revisions to make a probe pass. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AdtClient } from '../src/adt/client.js';
import { AdtApiError } from '../src/adt/errors.js';
import { assertCanonicalHostRelativeAdtPath, canonicalHostRelativeAdtPath } from '../src/adt/path-safety.js';
import { defaultSafetyConfig } from '../src/adt/safety.js';
import { ReviewBudget } from '../src/adt/transport-review-budget.js';
import { findDeepNodes, parseRevisionFeed, parseXml } from '../src/adt/xml-parser.js';

if (process.env.SAP_URL !== 'https://a4h.marianzeis.de' || process.env.SAP_CLIENT !== '001')
  throw new Error('This fixture probe requires the existing A4H HTTPS target, client 001.');
if (!process.env.SAP_USER || !process.env.SAP_PASSWORD || !process.argv[2])
  throw new Error('Supply existing SAP credentials and a new output directory.');
const directory = process.argv[2];
await mkdir(directory, { mode: 0o700 });
const client = new AdtClient({
  baseUrl: process.env.SAP_URL,
  client: '001',
  username: process.env.SAP_USER,
  password: process.env.SAP_PASSWORD,
  insecure: false,
  safety: defaultSafetyConfig(),
});
const budget = new ReviewBudget(); // 30 seconds, 180 attempts, 8 MiB total, 1 MiB per read.
const evidence: Record<string, unknown>[] = [];
let serial = 0;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
async function read(path: string, label: string) {
  assertCanonicalHostRelativeAdtPath(path);
  try {
    const response = await budget.read((request) => client.http.get(path, undefined, request));
    await writeFile(join(directory, `${++serial}.xml`), response.body, { flag: 'wx', mode: 0o600 });
    evidence.push({
      label,
      path,
      status: response.statusCode,
      bytes: Buffer.byteLength(response.body),
      sha256: hash(response.body),
    });
    return response.body;
  } catch (error) {
    evidence.push({
      label,
      path,
      status: error instanceof AdtApiError ? error.statusCode : 'error',
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return undefined;
  }
}
const fixtures = [
  ['domain-demo', '/sap/bc/adt/ddic/domains/ZARC1_TD_DOM'],
  ['domain-pilot', '/sap/bc/adt/ddic/domains/ZORFC_D_CHAR16'],
  ['data-element-pilot', '/sap/bc/adt/ddic/dataelements/ZORFC_CHAR16'],
  ['table-pilot', '/sap/bc/adt/ddic/tables/ZORFC_BETA_TX'],
  ['table-type-pilot', '/sap/bc/adt/ddic/tabletypes/ZORFC_CHAR16_T'],
  ['program-text', '/sap/bc/adt/textelements/programs/ZARC1_TD_REPORT'],
  ['class-text', '/sap/bc/adt/textelements/classes/ZCL_ARC1_TD_CALC'],
  ['function-group-pilot', '/sap/bc/adt/functions/groups/ZORFC_BETA_V1'],
] as const;
for (const [label, path] of fixtures) {
  if (budget.exhausted) break;
  const xml = await read(path, label);
  if (!xml) continue;
  const links = findDeepNodes(parseXml(xml), 'link').filter(
    (l) => l['@_rel'] === 'http://www.sap.com/adt/relations/versions',
  );
  if (links.length !== 1) {
    evidence.push({ label, history: links.length ? 'ambiguous' : 'not-advertised' });
    continue;
  }
  const href = String(links[0]!['@_href'] ?? '');
  const resolved = new URL(href, `https://a4h.marianzeis.de${path}${href.startsWith('./') ? '' : '/'}`);
  if (resolved.origin !== 'https://a4h.marianzeis.de') throw new Error('Foreign history relation refused.');
  const historyXml = await read(resolved.pathname + resolved.search, `${label}-history`);
  if (!historyXml) continue;
  const history = parseRevisionFeed(historyXml);
  const historical = history.revisions.filter((r) => !['active', 'inactive', '00000'].includes(r.id));
  evidence.push({
    label,
    history: {
      count: history.revisions.length,
      historicalCount: historical.length,
      revisions: history.revisions.map(({ id, uri, transport, isTestTransport }) => ({
        id,
        uri,
        transport,
        isTestTransport,
      })),
      continuation: history.continuationAdvertised === true,
    },
  });
  const payloads: string[] = [];
  for (const revision of historical.slice(0, 2)) {
    // This research-only allowlist is confined to the observed fixture owner. The product
    // adapter intentionally does not yet support DDIC/FUGR history.
    const uri = canonicalHostRelativeAdtPath(revision.uri);
    const owned = uri?.toLowerCase().startsWith(`${path.toLowerCase()}/`);
    const tail = uri?.slice(path.length);
    if (!uri || !owned || !/^\/(?:source\/main\/)?versions\/\d{14}\/\d{5}\/content$/.test(tail ?? '')) {
      evidence.push({ label, revision: revision.id, status: 'unsafe-source-refused' });
      continue;
    }
    const body = await read(uri, `${label}-revision-${revision.id}`);
    if (body !== undefined) payloads.push(hash(body));
  }
  evidence.push({
    label,
    historicalPair:
      payloads.length === 2
        ? payloads[0] === payloads[1]
          ? 'identical'
          : 'different-needs-contract-review'
        : 'not-established',
  });
}
await writeFile(
  join(directory, 'evidence.json'),
  JSON.stringify(
    {
      target: 'A4H/001',
      release: '758',
      collectedAt: new Date().toISOString(),
      mutationCount: 0,
      metrics: budget.metrics(),
      evidence,
    },
    null,
    2,
  ),
  { flag: 'wx', mode: 0o600 },
);
console.log(JSON.stringify({ output: join(directory, 'evidence.json'), metrics: budget.metrics() }));
