import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import {
  ExtensionDiscoverySession,
  extensionKey,
  renderExtensionDiscovery,
} from '../../../src/adt/extension-discovery.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { discoverSourcePlugins } from '../../../src/adt/source-plugin-discovery.js';
import { type SourcePluginUnit, sourcePluginObjectUri } from '../../../src/adt/source-plugin-resources.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/extensions/source/${name}`, import.meta.url), 'utf8');
const group = 'SEEF_ADT_TEST_AUNIT_FUGR1';
const main = `/sap/bc/adt/functions/groups/${group.toLowerCase()}`;
const meta = (u: SourcePluginUnit, advertised = false) =>
  `<object name="${u.name}" type="${u.type === 'INCL' ? 'PROG/I' : 'PROG/P'}" version="active">${advertised ? '<link rel="http://www.sap.com/adt/relations/enhancements" href="source/main/enhancements/elements"/>' : ''}</object>`;
function setup(
  mode: 'summary' | 'sources',
  unit: SourcePluginUnit,
  routes: Record<string, string>,
  context?: { type: 'FUGR' | 'PROG'; name: string },
) {
  const request = {
    root: { type: unit.type, name: unit.name, version: 'active' },
    scope: 'review regression',
    ...(context ? { context } : {}),
  };
  const session = new ExtensionDiscoverySession(mode, request, defaultSafetyConfig());
  const get = vi.fn(async (path: string, _headers: unknown, options: unknown) => {
    expect(options).toBe(session.options);
    session.options.attemptBudget!.consume();
    if (!(path in routes)) throw new Error(`Unexpected test route ${path}`);
    return { body: routes[path]! };
  });
  return { request, session, get, client: { http: { get } } as unknown as AdtClient };
}
describe('source plug-in review regressions', () => {
  describe.each(['summary', 'sources'] as const)('%s structural includes', (mode) => {
    it.each([true, false])('binds the first FUNCTION header in the selected include: %s', async (matching) => {
      const unit = { type: 'INCL' as const, name: 'LSEEF_ADT_TEST_AUNIT_FUGR1U01' };
      const uri = sourcePluginObjectUri(unit);
      const source = matching ? fixture('fugr-u01.abap') : 'DATA(text) = |\nFUNCTION seef_adt_test_aunit_fmodule1.\n|.';
      const s = setup(
        mode,
        unit,
        {
          [`${uri}?version=active`]: meta(unit, true),
          [`${uri}/source/main/enhancements/elements?context=${encodeURIComponent(main)}`]: fixture('fugr-u01-758.xml'),
        },
        { type: 'FUGR', name: group },
      );
      await discoverSourcePlugins(s.client, s.session, s.request, { unit, source });
      expect(s.session.stopped).toBe(!matching);
      expect(s.session.result.nodes).toHaveLength(matching ? 1 : 0);
      expect(s.get).toHaveBeenCalledTimes(2);
    });
    it('accepts a valid header in an oversized base and reports the source scan limit', async () => {
      const unit = { type: 'INCL' as const, name: 'LSEEF_ADT_TEST_AUNIT_FUGR1U01' };
      const uri = sourcePluginObjectUri(unit);
      const source = fixture('fugr-u01.abap') + ' '.repeat(256 * 1024);
      const s = setup(
        mode,
        unit,
        {
          [`${uri}?version=active`]: meta(unit, true),
          [`${uri}/source/main/enhancements/elements?context=${encodeURIComponent(main)}`]: fixture('fugr-u01-758.xml'),
        },
        { type: 'FUGR', name: group },
      );
      await discoverSourcePlugins(s.client, s.session, s.request, { unit, source });
      expect(s.session.stopped).toBe(false);
      expect(s.session.result.nodes).toHaveLength(1);
      if (mode === 'sources') expect(s.session.result.issues).toContain(`source_scan_byte_limit:INCL:${unit.name}`);
    });
  });

  it('uses one bounded source read for an uncaptured summary header', async () => {
    const unit = { type: 'INCL' as const, name: 'LSEEF_ADT_TEST_AUNIT_FUGR1U01' };
    const uri = sourcePluginObjectUri(unit);
    const s = setup(
      'summary',
      unit,
      {
        [`${uri}?version=active`]: meta(unit, true),
        [`${uri}/source/main?version=active`]: fixture('fugr-u01.abap'),
        [`${uri}/source/main/enhancements/elements?context=${encodeURIComponent(main)}`]: fixture('fugr-u01-758.xml'),
      },
      { type: 'FUGR', name: group },
    );
    await discoverSourcePlugins(s.client, s.session, s.request, { unit });
    expect(s.session.result.nodes).toHaveLength(1);
    expect(s.get).toHaveBeenCalledTimes(3);
    expect(s.session.result.providers[0]?.status).toBe('returned');
  });

  it('keeps oversized provider metadata parseable without losing budget or context', () => {
    const unit = { type: 'INCL' as const, name: 'ZPART' };
    const context = { type: 'PROG' as const, name: 'ZROOT' };
    const s = setup('summary', unit, {}, context);
    s.session.result.providers.push({
      id: 'source_plugins',
      family: 'source_plugin',
      status: 'returned',
      coverage: 'selected_source',
      reason: 'x'.repeat(4000),
    });
    const block = renderExtensionDiscovery(s.session.finish())[0]!.text;
    expect(Buffer.byteLength(block)).toBeLessThanOrEqual(2048);
    const report = JSON.parse(block.replace('[extensions] ', ''));
    expect(report.context).toEqual(context);
    expect(report.providers[0]).toMatchObject({ status: 'returned', coverage: 'selected_source' });
    expect(report.identities).toEqual([]);
    expect(report.omissions.output).toBeGreaterThan(0);
    expect(report.issues).toContain('summary_metadata_omitted');
    expect(report.consumed.sends).toBe(0);
  });

  it.each(['occurrences', 'depth', 'nodes'] as const)(
    'does not relabel a %s cutoff as provider absence',
    async (limit) => {
      const unit = { type: 'PROG' as const, name: 'ZROOT' };
      const uri = sourcePluginObjectUri(unit);
      const routes = { [`${uri}?version=active`]: meta(unit) };
      const s = setup('sources', unit, routes);
      let source: string;
      if (limit === 'occurrences') {
        source = 'INCLUDE ZCHILD.\n'.repeat(201);
        const child = { type: 'INCL' as const, name: 'ZCHILD' };
        routes[`${sourcePluginObjectUri(child)}?version=active`] = meta(child);
        s.session.sourceCache.set(extensionKey({ ...child, version: 'active' }), '');
      } else {
        const count = limit === 'depth' ? 7 : 21;
        source =
          limit === 'depth' ? 'INCLUDE ZC0.' : Array.from({ length: count }, (_, i) => `INCLUDE ZC${i}.`).join('\n');
        for (let i = 0; i < count; i++) {
          const child = { type: 'INCL' as const, name: `ZC${i}` };
          routes[`${sourcePluginObjectUri(child)}?version=active`] = meta(child);
          s.session.sourceCache.set(
            extensionKey({ ...child, version: 'active' }),
            limit === 'depth' ? `INCLUDE ZC${i + 1}.` : '',
          );
        }
      }
      await discoverSourcePlugins(s.client, s.session, s.request, { unit, source });
      expect(s.session.result.providers[0]?.status).toBe('incomplete');
      expect(s.session.result.omissions[limit === 'depth' ? 'depth' : 'nodes']).toBeGreaterThan(0);
      expect(s.session.stopped).toBe(false);
    },
  );

  it.each([
    { root: 'ZROOT', child: 'SAP_INCLUDE', allowed: false },
    { root: '/NS/ROOT', child: '/OTHER/CHILD', allowed: false },
    { root: '/NS/ROOT', child: '/NS/CHILD', allowed: true },
  ])('uses the inherited owner $root to admit $child', async ({ root, child, allowed }) => {
    const unit = { type: 'INCL' as const, name: 'ZPART' };
    const nested = { type: 'INCL' as const, name: child };
    const s = setup(
      'sources',
      unit,
      {
        [`${sourcePluginObjectUri(unit)}?version=active`]: meta(unit),
        [`${sourcePluginObjectUri(nested)}?version=active`]: meta(nested),
      },
      { type: 'PROG', name: root },
    );
    s.session.sourceCache.set(extensionKey({ ...nested, version: 'active' }), '');
    await discoverSourcePlugins(s.client, s.session, s.request, { unit, source: `INCLUDE ${child}.` });
    expect(s.get).toHaveBeenCalledTimes(allowed ? 2 : 1);
    expect(s.session.result.issues.includes(`include_ownership_skipped:${child}`)).toBe(!allowed);
  });

  it('skips an unsupported generated name and still reads its sibling', async () => {
    const unit = { type: 'PROG' as const, name: 'SAPROOT' };
    const child = { type: 'INCL' as const, name: 'ZVALID' };
    const s = setup('sources', unit, {
      [`${sourcePluginObjectUri(unit)}?version=active`]: meta(unit),
      [`${sourcePluginObjectUri(child)}?version=active`]: meta(child),
    });
    s.session.sourceCache.set(extensionKey({ ...child, version: 'active' }), '');
    await discoverSourcePlugins(s.client, s.session, s.request, { unit, source: 'INCLUDE %_X.\nINCLUDE ZVALID.' });
    expect(s.session.stopped).toBe(false);
    expect(s.get).toHaveBeenCalledTimes(2);
    expect(s.session.result.issues).toContain('include_name_not_supported:%_X');
    expect(s.session.result.providers[0]?.status).toBe('incomplete');
  });

  it('retains parseable budget metadata and identities with many skipped includes', async () => {
    const unit = { type: 'PROG' as const, name: 'ZROOT' };
    const uri = sourcePluginObjectUri(unit);
    const s = setup('sources', unit, {
      [`${uri}?version=active`]: meta(unit, true),
      [`${uri}/source/main/enhancements/elements`]: fixture('nested-750.xml')
        .replaceAll('ENH_NESTED_DEMO', 'ZROOT')
        .replaceAll('enh_nested_demo', 'zroot'),
    });
    await discoverSourcePlugins(s.client, s.session, s.request, {
      unit,
      source: Array.from({ length: 60 }, (_, i) => `INCLUDE SAP_CHILD_${i}.`).join('\n'),
    });
    const block = renderExtensionDiscovery(s.session.finish())[0]!.text;
    expect(Buffer.byteLength(block)).toBeLessThanOrEqual(2048);
    const report = JSON.parse(block.replace('[extensions] ', ''));
    expect(report.identities.length).toBeGreaterThan(0);
    expect(report.consumed.sends).toBe(2);
    expect(report.omissions).toBeDefined();
    expect(report.issues.join(' ')).toMatch(/issues_omitted/);
  });

  it('joins the complete nested parent chain to its canonical root', async () => {
    const unit = { type: 'PROG' as const, name: 'ENH_NESTED_DEMO' };
    const uri = sourcePluginObjectUri(unit);
    const s = setup('summary', unit, {
      [`${uri}?version=active`]: fixture('prog-metadata-npl.xml'),
      [`${uri}/source/main/enhancements`]: fixture('nested-750.xml'),
    });
    await discoverSourcePlugins(s.client, s.session, s.request, { unit, source: '' });
    expect(s.session.result.providers[0]?.nested).toBe('bounded');
    const keys = new Set(s.session.result.nodes.map(extensionKey));
    keys.add(extensionKey(s.request.root));
    expect(
      s.session.result.edges.filter((e) => e.kind === 'parent').every((e) => keys.has(e.from) && keys.has(e.to)),
    ).toBe(true);
  });
});
