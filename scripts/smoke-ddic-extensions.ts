/** Read-only live smoke. Supply the existing SAP_URL/SAP_USER/SAP_PASSWORD/SAP_CLIENT environment. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { AdtClient } from '../src/adt/client.js';
import { DDIC_ELEMENTS_MIME, parseDdicAppendElements } from '../src/adt/ddic-extensions.js';
import { ExtensionDiscoverySession } from '../src/adt/extension-discovery.js';
import { defaultSafetyConfig } from '../src/adt/safety.js';
import { buildStructureHierarchy } from '../src/adt/structure-hierarchy.js';
import { handleSAPRead } from '../src/handlers/read.js';
import { initLogger } from '../src/server/logger.js';

initLogger('text', 'error');
const buildHash = createHash('sha256');
for (const path of readdirSync(new URL('../src/', import.meta.url), { recursive: true, encoding: 'utf8' })
  .filter((path) => path.endsWith('.ts'))
  .sort()) {
  buildHash.update(path);
  buildHash.update('\0');
  buildHash.update(readFileSync(new URL(`../src/${path}`, import.meta.url)));
}
const sourceTreeSha256 = buildHash.digest('hex');
const target = process.env.EXTENSION_SMOKE_TARGET;
assert(target === 'a4h' || target === 'npl', 'Set EXTENSION_SMOKE_TARGET=a4h or npl.');
const url = `https://${target}.marianzeis.de`;
assert.equal(process.env.SAP_URL?.replace(/\/$/, ''), url, 'Smoke is restricted to the authorized HTTPS test targets.');
assert(process.env.SAP_USER && process.env.SAP_PASSWORD, 'Existing SAP credentials required.');
const client = new AdtClient({
  baseUrl: url,
  username: process.env.SAP_USER,
  password: process.env.SAP_PASSWORD,
  client: '001',
  language: 'EN',
  safety: defaultSafetyConfig(),
});
const read = (name: string, extensions?: string) =>
  handleSAPRead(
    client,
    { type: 'TABL', name, ...(extensions ? { extensions } : {}) },
    undefined,
    { isPerUserClient: false },
    false,
  );
const rows: unknown[] = [];
const only = process.env.EXTENSION_SMOKE_CASE;
try {
  for (const [name, expected] of [
    ['DSH_MEAL', 'DSH_S_MEAL_APPEND'],
    ['DDTEST_STRU_INCLUDE', 'DDTEST_APPEND_ACTIVE'],
    ['TEST_SBD_TWO_FIELDS_CLASS_INTF', 'TEST_SBD_APPEND_ADD_VH'],
    ['FDT_S_TEST_SFW', target === 'a4h' ? 'FDT_S_TEST_SFW_APPEND1_OFF' : undefined],
    ['SFLIGHT', undefined],
  ]) {
    if (only && name !== only) continue;
    const legacy = await read(name!, 'none');
    assert.equal(legacy.content.length, 1);
    const result = await read(name!);
    assert.deepEqual(result.content[0], legacy.content[0], 'Base source changed.');
    const summary = JSON.parse(result.content[1]!.text.replace(/^\[extensions\] /, ''));
    rows.push({
      name,
      mode: 'summary',
      basePreserved: true,
      sourceHash: createHash('sha256').update(legacy.content[0]!.text).digest('hex'),
      summary,
    });
    const deadline = summary.providers[0].status === 'incomplete' && summary.omissions.deadline > 0;
    if (!deadline) {
      if (expected)
        assert(
          summary.identities.some((node: { name: string }) => node.name === expected),
          `Missing ${expected}`,
        );
      else assert.equal(summary.providers[0].status, 'not_advertised');
    }
    assert(summary.consumed.sends <= 6);
  }
  if (!only || only === 'DSH_MEAL') {
    const expanded = await read('DSH_MEAL', 'sources');
    const expansionSummary = JSON.parse(expanded.content[1]!.text.replace(/^\[extensions\] /, ''));
    assert(
      expanded.content.some((block) => block.text.includes('representation=authored_source')) ||
        expansionSummary.omissions.deadline > 0 ||
        expansionSummary.omissions.requests > 0,
    );
    rows.push({
      name: 'DSH_MEAL',
      mode: 'sources',
      summary: JSON.parse(expanded.content[1]!.text.replace(/^\[extensions\] /, '')),
      labelledSources: expanded.content
        .filter((block) => block.text.startsWith('[extension source '))
        .map((block) => block.text.split('\n')[0]),
      extensionOutputBytes: expanded.content.slice(1).reduce((sum, block) => sum + Buffer.byteLength(block.text), 0),
    });
  }
  if (!only || only === 'DDTEST_STRU_INCLUDE') {
    const hierarchy = await buildStructureHierarchy(client, 'DDTEST_STRU_INCLUDE');
    assert(
      hierarchy.tree.children.some((child) => child.structure === 'DDTEST_APPEND_ACTIVE') ||
        hierarchy.extensionDiscovery?.omissions.deadline ||
        hierarchy.extensionDiscovery?.omissions.requests,
    );
    assert.deepEqual(
      hierarchy.tree.children.filter((child) => child.structure === 'DDTEST_STRU_CHAR').map((child) => child.suffix),
      ['a', 'b', undefined],
    );
    rows.push({
      name: 'DDTEST_STRU_INCLUDE',
      mode: 'structure',
      tree: hierarchy.tree,
      summary: hierarchy.summary,
      discovery: hierarchy.extensionDiscovery,
      warnings: hierarchy.warnings,
    });
  }
  if (!only || only === 'SFLIGHT') {
    const base = `/sap/bc/adt/ddic/${target === 'npl' ? 'structures' : 'tables'}/sflight`;
    const session = new ExtensionDiscoverySession(
      'summary',
      {
        root: { type: 'TABL', name: 'SFLIGHT', version: 'active' },
        scope: 'explicit direct empty-format qualification',
      },
      client.safety,
    );
    const response = await session.read('TABL', (options) =>
      client.http.get(
        `${base}/${target === 'npl' ? 'enhancements' : 'enhancement/elements'}`,
        { Accept: DDIC_ELEMENTS_MIME },
        options,
      ),
    );
    assert.deepEqual(parseDdicAppendElements(response.body, base, 'SFLIGHT'), []);
    rows.push({ name: 'SFLIGHT', mode: 'direct empty-format qualification', anonymousEmptyAccepted: true });
  }
} catch (error) {
  rows.push({ failed: true, error: error instanceof Error ? error.name : 'unknown' });
  process.exitCode = 1;
}
process.stdout.write(
  `${JSON.stringify({ target, sourceTreeSha256, timestamp: new Date().toISOString(), client: '001', authRoute: 'local Basic HTTPS', rows }, null, 2)}\n`,
);
