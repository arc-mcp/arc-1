/** Read-only qualification. Supply SAP_* credentials via environment; never records credentials/bodies. */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { AdtClient } from '../src/adt/client.js';
import { ExtensionDiscoverySession, renderExtensionDiscovery } from '../src/adt/extension-discovery.js';
import { defaultSafetyConfig } from '../src/adt/safety.js';
import { discoverSourcePlugins } from '../src/adt/source-plugin-discovery.js';
import { type SourcePluginUnit, sourcePluginObjectUri } from '../src/adt/source-plugin-resources.js';
import { handleSAPRead } from '../src/handlers/read.js';

const target = process.env.SOURCE_PLUGIN_TARGET;
if (target !== 'a4h' && target !== 'npl') throw new Error('SOURCE_PLUGIN_TARGET must be a4h or npl.');
const expectedUrl = `https://${target}.marianzeis.de`;
if (process.env.SAP_URL !== expectedUrl) throw new Error('Use the qualified HTTPS 443 target URL.');
const client = new AdtClient({
  baseUrl: expectedUrl,
  username: process.env.SAP_USER,
  password: process.env.SAP_PASSWORD,
  client: '001',
  language: 'EN',
  insecure: false,
  safety: defaultSafetyConfig(),
});
const cases: Array<{
  unit: SourcePluginUnit;
  mode: 'summary' | 'sources';
  context?: { type: 'PROG' | 'FUGR' | 'CLAS'; name: string };
}> =
  target === 'npl'
    ? [{ unit: { type: 'PROG', name: 'ENH_NESTED_DEMO' }, mode: 'sources' }]
    : [
        {
          unit: { type: 'INCL', name: 'ENH_PROG_INCL_IMPLICIT_OPT' },
          mode: 'sources',
          context: { type: 'PROG', name: 'PROG_ENH_SUBOBJ_CHECK' },
        },
        { unit: { type: 'FUGR', name: 'SEEF_ADT_TEST_AUNIT_FUGR1' }, mode: 'summary' },
        { unit: { type: 'FUGR', name: 'SEEF_ADT_TEST_AUNIT_FUGR1' }, mode: 'sources' },
        { unit: { type: 'FUNC', name: 'SAPBC_GLOBAL_CANCEL_UPDATE', group: 'SAPBC_GLOBAL_FIS' }, mode: 'sources' },
        { unit: { type: 'FUNC', name: 'BDS_CONNECTION_CREATE', group: 'BDS_CONNECTIONS' }, mode: 'sources' },
      ];
const results = [];
for (const test of cases) {
  if (process.env.SOURCE_PLUGIN_HANDLER === 'true') {
    const args = { ...test.unit, version: 'active', ...(test.context ? { enhancementContext: test.context } : {}) };
    const base = await handleSAPRead(
      client,
      { ...args, extensions: 'none' },
      undefined,
      { isPerUserClient: false },
      false,
    );
    const output = await handleSAPRead(
      client,
      { ...args, extensions: test.mode },
      undefined,
      { isPerUserClient: false },
      false,
    );
    const basePreserved = !base.isError && !output.isError && base.content[0]?.text === output.content[0]?.text;
    if (!basePreserved) throw new Error('Successful legacy base source was not preserved.');
    const summary = JSON.parse(output.content[1]!.text.replace('[extensions] ', ''));
    results.push({
      target,
      unit: test.unit,
      mode: test.mode,
      basePreserved,
      baseSha256: createHash('sha256').update(base.content[0]!.text).digest('hex'),
      summary,
      graph: output.content
        .filter((b) => b.text.startsWith('[extension graph] '))
        .map((b) => JSON.parse(b.text.replace('[extension graph] ', ''))),
      sourceHashes: output.content
        .filter((b) => b.text.startsWith('[extension source '))
        .map((b) => ({
          label: b.text.split('\n', 1)[0],
          sha256: createHash('sha256')
            .update(b.text.slice(b.text.indexOf('\n') + 1))
            .digest('hex'),
        })),
    });
    continue;
  }
  const request = {
    root: { type: test.unit.type, name: test.unit.name, version: 'active' },
    scope: `${test.unit.type} ${test.unit.name}`,
    ...(test.context ? { context: test.context } : {}),
  };
  const session = new ExtensionDiscoverySession(test.mode, request, client.safety);
  await discoverSourcePlugins(client, session, request, { unit: test.unit });
  const result = session.finish();
  const output = renderExtensionDiscovery(result);
  results.push({
    target,
    unit: test.unit,
    mode: test.mode,
    providers: result.providers,
    identities: result.nodes,
    edges: result.edges,
    omissions: result.omissions,
    issues: result.issues,
    consumed: result.consumed,
    outputBytes: output.reduce((n, b) => n + Buffer.byteLength(b.text), 0),
    sources: result.sources.map((s) => ({
      identity: s.identity,
      representation: s.representation,
      bytes: Buffer.byteLength(s.source),
      sha256: createHash('sha256').update(s.source).digest('hex'),
    })),
  });
}
// Optional fixture capture is limited to these exact standard SAP metadata objects and the same budget.
if (process.env.SOURCE_PLUGIN_METADATA_DIR) {
  const units: SourcePluginUnit[] =
    target === 'npl'
      ? [{ type: 'PROG', name: 'ENH_NESTED_DEMO' }]
      : [
          { type: 'INCL', name: 'ENH_PROG_INCL_IMPLICIT_OPT' },
          { type: 'FUNC', name: 'SAPBC_GLOBAL_CANCEL_UPDATE', group: 'SAPBC_GLOBAL_FIS' },
        ];
  for (const unit of units) {
    const request = { root: { ...unit, version: 'active' }, scope: 'fixture metadata' };
    const session = new ExtensionDiscoverySession('sources', request, client.safety);
    const response = await session.read(unit.type, (options) =>
      client.http.get(`${sourcePluginObjectUri(unit)}?version=active`, { Accept: 'application/*' }, options),
    );
    writeFileSync(
      `${process.env.SOURCE_PLUGIN_METADATA_DIR}/${unit.type.toLowerCase()}-metadata-${target}.xml`,
      response.body,
    );
  }
}
const json = JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2);
if (process.env.SOURCE_PLUGIN_OUTPUT) writeFileSync(process.env.SOURCE_PLUGIN_OUTPUT, `${json}\n`);
process.stdout.write(`${json}\n`);
