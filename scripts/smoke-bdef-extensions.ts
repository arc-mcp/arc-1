/** Read-only qualification. Supply existing SAP_* credentials; output contains no source/auth bodies. */
import { createHash } from 'node:crypto';
import { discoverBdefExtensions } from '../src/adt/bdef-extensions.js';
import { AdtClient } from '../src/adt/client.js';
import { DataResponseBudget } from '../src/adt/data-result-context.js';
import { ExtensionDiscoverySession, renderExtensionDiscovery } from '../src/adt/extension-discovery.js';
import { RequestAttemptBudget } from '../src/adt/request-attempt-budget.js';
import { checkOperation, OperationType } from '../src/adt/safety.js';
import { parseDiscoveryDocument } from '../src/adt/xml-parser.js';

const target = process.env.BDEF_SMOKE_TARGET;
if (target !== 'a4h' && target !== 'npl') throw new Error('Set BDEF_SMOKE_TARGET=a4h or npl.');
const client = new AdtClient({
  baseUrl: `https://${target}.marianzeis.de`,
  username: process.env.SAP_USER,
  password: process.env.SAP_PASSWORD,
  client: '001',
  language: 'EN',
  insecure: false,
});
const options = {
  deadline: Date.now() + 15000,
  attemptBudget: new RequestAttemptBudget(6),
  responseBudget: new DataResponseBudget(1024 * 1024),
  retryTransientErrors: false,
};
// Normal capability bootstrap is separate from the optional phase, as at server startup.
checkOperation(client.safety, OperationType.Read, 'SmokeBdefDiscovery');
const discovery = parseDiscoveryDocument(
  (await client.http.get('/sap/bc/adt/discovery', { Accept: 'application/atomsvc+xml' }, options)).body,
);
const request = {
  root: { type: 'BDEF', name: 'DEMO_RAP_EXTENSIBLE', version: 'active' },
  scope: 'BDEF DEMO_RAP_EXTENSIBLE owning_object',
};
const base =
  target === 'a4h' ? (await client.getBdef('demo_rap_extensible', { ...options, version: 'active' })).source : '';
const rows = [];
for (const mode of ['summary', 'sources'] as const) {
  const session = new ExtensionDiscoverySession(mode, request, client.safety);
  await discoverBdefExtensions(client, session, request, base, {
    discovery,
    abapRelease: target === 'a4h' ? '758' : '750',
  });
  const result = session.finish();
  rows.push({
    mode,
    providers: result.providers,
    nodes: result.nodes,
    edges: result.edges,
    omissions: result.omissions,
    issues: result.issues,
    consumed: result.consumed,
    outputBytes: renderExtensionDiscovery(result).reduce((sum, block) => sum + Buffer.byteLength(block.text), 0),
    sources: result.sources.map(({ identity, source, representation }) => ({
      identity,
      representation,
      bytes: Buffer.byteLength(source),
      sha256: createHash('sha256').update(source).digest('hex'),
    })),
  });
}
process.stdout.write(
  `${JSON.stringify({ target, checkedAt: new Date().toISOString(), baseRead: target === 'a4h', baseSha256: base ? createHash('sha256').update(base).digest('hex') : null, rows }, null, 2)}\n`,
);
