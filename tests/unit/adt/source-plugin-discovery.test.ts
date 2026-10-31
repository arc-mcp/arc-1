import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { ExtensionDiscoverySession } from '../../../src/adt/extension-discovery.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { discoverSourcePlugins } from '../../../src/adt/source-plugin-discovery.js';
import { sourcePluginObjectUri, sourcePluginResources } from '../../../src/adt/source-plugin-resources.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/extensions/source/${name}`, import.meta.url), 'utf8');
const group = 'SEEF_ADT_TEST_AUNIT_FUGR1';
const base = `/sap/bc/adt/functions/groups/${group.toLowerCase()}`;
const empty = '<enh:enhancements xmlns:enh="http://www.sap.com/adt/abapsource/enhancements"/>';
const req = { root: { type: 'FUGR', name: group, version: 'active' }, scope: `FUGR ${group}` };
const metadata = (name: string, type: string, _path: string) =>
  `<object xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}" adtcore:type="${type}" adtcore:version="active"><link rel="http://www.sap.com/adt/relations/enhancements" href="source/main/enhancements/elements"/></object>`;

function setup(
  mode: 'summary' | 'sources',
  routes: Record<string, string | Error>,
  denyActions: string[] = [],
  request = req,
) {
  const session = new ExtensionDiscoverySession(mode, request, { ...defaultSafetyConfig(), denyActions });
  const get = vi.fn(async (path: string, _headers: unknown, options: unknown) => {
    expect(options).toBe(session.options);
    expect(session.options.retryTransientErrors).toBe(false);
    session.options.attemptBudget!.consume();
    const value = routes[path];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new AdtApiError('missing test route', 404, path);
    return { body: value };
  });
  const client = { http: { get } } as unknown as AdtClient;
  return { session, get, client };
}
const rootRoutes = {
  [`${base}?version=active`]: fixture('fugr-metadata-758.xml'),
  [`${base}/source/main/enhancements/elements`]: empty,
};
describe('source plugin discovery', () => {
  it.each([
    { type: 'FUNC' as const, name: 'ZFUNC', group: 'ZGROUP' },
    { type: 'CLAS' as const, name: 'ZCLASS', section: 'definitions' as const },
  ])('reports an unadvertised summary provider for $type instead of a valid empty list', async (unit) => {
    const uri = sourcePluginObjectUri(unit);
    const nativeType = unit.type === 'FUNC' ? 'FUGR/FF' : 'CLAS/OC';
    const s = setup('summary', {
      [`${uri}?version=active`]: `<object name="${unit.name}" type="${nativeType}" version="active"/>`,
    });
    await discoverSourcePlugins(s.client, s.session, req, { unit });
    expect(s.session.result.providers[0]?.status).toBe('not_advertised');
    expect(s.session.result.issues).toContain(`enhancement_relation_not_advertised:${unit.type}:${unit.name}`);
    expect(s.get).toHaveBeenCalledTimes(1);
    expect(s.session.result.nodes).toEqual([]);
  });
  it.each(['750', '758'])('exposes the complete class fixture graph to the stage 3 caller on %s', async (version) => {
    const unit = { type: 'CLAS' as const, name: 'CL_SEEF_ADT_TEST_AUNIT_1' };
    const uri = '/sap/bc/adt/oo/classes/cl_seef_adt_test_aunit_1';
    const request = { root: { ...unit, version: 'active' }, scope: 'class main' };
    const s = setup(
      'sources',
      {
        [`${uri}?version=active`]: fixture(`class-metadata-${version}.xml`),
        [`${uri}/source/main/enhancements${version === '758' ? '/elements' : ''}`]: fixture(`class-${version}.xml`),
      },
      [],
      request,
    );
    await discoverSourcePlugins(s.client, s.session, request, { unit, source: '' });
    expect(s.session.result.nodes).toHaveLength(7);
    expect(s.session.result.edges.filter((e) => e.kind === 'replacement')).toHaveLength(3);
    expect(s.session.result.sources).toHaveLength(8);
    expect(s.get).toHaveBeenCalledTimes(2);
  });

  it('does not borrow class-main identities for a selected local section', async () => {
    const unit = { type: 'CLAS' as const, name: 'CL_SEEF_ADT_TEST_AUNIT_1', section: 'definitions' as const };
    const uri = '/sap/bc/adt/oo/classes/cl_seef_adt_test_aunit_1';
    const request = { root: { type: 'CLAS', name: unit.name, version: 'active' }, scope: 'class definitions' };
    const s = setup(
      'summary',
      {
        [`${uri}?version=active`]: fixture('class-metadata-758.xml'),
        [`${uri}/includes/definitions/enhancements/elements`]: empty,
      },
      [],
      request,
    );
    await discoverSourcePlugins(s.client, s.session, request, { unit });
    expect(s.session.result.nodes).toEqual([]);
    expect(s.session.result.providers[0]?.coverage).toBe('selected_source');
    expect(s.get).toHaveBeenCalledTimes(2);
  });
  it.each(['summary', 'sources'] as const)('keeps the qualified 750 provenance in %s mode', async (mode) => {
    const unit = { type: 'PROG' as const, name: 'ENH_NESTED_DEMO' };
    const uri = '/sap/bc/adt/programs/programs/enh_nested_demo';
    const request = { root: { ...unit, version: 'active' }, scope: '750 program' };
    const s = setup(
      mode,
      {
        [`${uri}?version=active`]: fixture('prog-metadata-npl.xml'),
        [`${uri}/source/main/enhancements`]: fixture('nested-750.xml'),
      },
      [],
      request,
    );
    await discoverSourcePlugins(s.client, s.session, request, { unit, source: '' });
    expect(s.session.result.nodes).toHaveLength(4);
    expect(s.session.result.sources).toHaveLength(mode === 'sources' ? 4 : 0);
    expect(s.session.result.providers[0]?.reason).toContain('750 unadvertised');
    expect(s.get).toHaveBeenCalledTimes(2);
  });
  it('uses the cheap root identity provider in summary mode with no source traversal', async () => {
    const unit = { type: 'CLAS' as const, name: 'CL_SEEF_ADT_TEST_AUNIT_1' };
    const uri = '/sap/bc/adt/oo/classes/cl_seef_adt_test_aunit_1';
    const s = setup('summary', {
      [`${uri}?version=active`]: fixture('class-metadata-758.xml'),
      [`${uri}/enhancements/implementations`]: fixture('class-identities-758.xml'),
    });
    await discoverSourcePlugins(s.client, s.session, req, { unit });
    expect(s.get).toHaveBeenCalledTimes(2);
    expect(s.session.result.nodes).toHaveLength(2);
    expect(s.session.result.sources).toEqual([]);
    expect(s.session.result.providers[0]).toMatchObject({ coverage: 'direct_identities', nested: 'not_expanded' });
  });
  it('does not treat empty FUGR main as completeness; reaches positive F01 with inherited group context', async () => {
    const include = 'LSEEF_ADT_TEST_AUNIT_FUGR1F01';
    const uri = `/sap/bc/adt/programs/includes/${include.toLowerCase()}`;
    const s = setup('sources', {
      ...rootRoutes,
      [`${base}/source/main?version=active`]: `INCLUDE ${include}.`,
      [`${uri}?version=active`]: metadata(include, 'PROG/I', uri),
      [`${uri}/source/main/enhancements/elements?context=${encodeURIComponent(base)}`]: fixture('fugr-f01-758.xml'),
      [`${uri}/source/main?version=active`]: 'FORM f. ENDFORM.',
    });
    await discoverSourcePlugins(s.client, s.session, req, { unit: { type: 'FUGR', name: group } });
    expect(s.session.result.nodes).toHaveLength(3);
    expect(s.session.result.sources).toHaveLength(4);
    expect(s.session.result.edges.filter((e) => e.kind === 'replacement')).toHaveLength(2);
    expect(s.get).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(s.get.mock.calls)).not.toContain('include_nested');
  });
  it.each([true, false])(
    'binds structural include function locations to the actual first FUNCTION header: %s',
    async (matching) => {
      const include = 'LSEEF_ADT_TEST_AUNIT_FUGR1U01';
      const uri = `/sap/bc/adt/programs/includes/${include.toLowerCase()}`;
      const source = matching
        ? fixture('fugr-u01.abap')
        : `" FUNCTION seef_adt_test_aunit_fmodule1.\nDATA(text) = |\nFUNCTION seef_adt_test_aunit_fmodule1.\n|.`;
      const s = setup('sources', {
        ...rootRoutes,
        [`${uri}?version=active`]: metadata(include, 'PROG/I', uri),
        [`${uri}/source/main?version=active`]: source,
        [`${uri}/source/main/enhancements/elements?context=${encodeURIComponent(base)}`]: fixture('fugr-u01-758.xml'),
      });
      await discoverSourcePlugins(s.client, s.session, req, {
        unit: { type: 'FUGR', name: group },
        source: `INCLUDE ${include}.`,
      });
      expect(s.session.stopped).toBe(!matching);
      expect(s.session.result.nodes).toHaveLength(matching ? 1 : 0);
      expect(s.get).toHaveBeenCalledTimes(5);
    },
  );
  it('requires standalone INCL context before reading an apparently empty provider', async () => {
    const request = {
      root: { type: 'INCL', name: 'ENH_PROG_INCL_IMPLICIT_OPT', version: 'active' },
      scope: 'selected include',
    };
    const s = setup('sources', {}, [], request);
    await discoverSourcePlugins(s.client, s.session, request, {
      unit: { type: 'INCL', name: request.root.name },
      source: '',
    });
    expect(s.session.result.providers[0]?.status).toBe('context_required');
    expect(s.get).not.toHaveBeenCalled();
  });
  it('uses selected FUNC source and its group context; does not read the whole group', async () => {
    const name = 'SAPBC_GLOBAL_CANCEL_UPDATE';
    const uri = '/sap/bc/adt/functions/groups/sapbc_global_fis/fmodules/sapbc_global_cancel_update';
    const request = { root: { type: 'FUNC', name, version: 'active' }, scope: 'selected function' };
    const s = setup(
      'sources',
      {
        [`${uri}?version=active`]: metadata(name, 'FUGR/FF', uri),
        [`${uri}/source/main/enhancements/elements`]: fixture('function-758.xml'),
      },
      [],
      request,
    );
    await discoverSourcePlugins(s.client, s.session, request, {
      unit: { type: 'FUNC', name, group: 'SAPBC_GLOBAL_FIS' },
      source: fixture('function.abap'),
    });
    expect(s.session.result.nodes[0]?.name).toBe('/SMFND/DEMO_DEL_BOOKING');
    expect(s.session.result.sources[0]?.source).toContain('syclo');
    expect(fixture('function.abap')).not.toContain('syclo');
    expect(s.get).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 429])('stops traversal after HTTP %s without other source requests', async (status) => {
    const s = setup('sources', {
      ...rootRoutes,
      [`${base}/source/main/enhancements/elements`]: new AdtApiError('sensitive', status, '/x'),
    });
    await discoverSourcePlugins(s.client, s.session, req, { unit: { type: 'FUGR', name: group } });
    expect(s.get).toHaveBeenCalledTimes(2);
    expect(s.session.stopped).toBe(true);
    expect(JSON.stringify(s.session.result)).not.toContain('sensitive');
  });
  it('honors hidden ENHO denial before reading elements or source', async () => {
    const s = setup('sources', rootRoutes, ['SAPRead.ENHO']);
    await discoverSourcePlugins(s.client, s.session, req, { unit: { type: 'FUGR', name: group } });
    expect(s.get).toHaveBeenCalledTimes(1);
    expect(s.session.result.providers[0]?.status).toBe('denied');
  });
  it('rejects inactive extension coverage without substituting an active observation', async () => {
    const s = setup('summary', {});
    await discoverSourcePlugins(
      s.client,
      s.session,
      { ...req, root: { ...req.root, version: 'inactive' } },
      { unit: { type: 'FUGR', name: group } },
    );
    expect(s.get).not.toHaveBeenCalled();
    expect(s.session.result.providers[0]).toMatchObject({ status: 'unsupported', reason: 'unsupported_version' });
  });

  it('preserves repeated include occurrences, deduplicates reads, and terminates cycles', async () => {
    const root = 'ZROOT',
      child = 'ZCHILD';
    const uri = (name: string) => `/sap/bc/adt/programs/includes/${name.toLowerCase()}`;
    const context = { type: 'PROG' as const, name: 'ZOWNER' };
    const contextParam = encodeURIComponent('/sap/bc/adt/programs/programs/zowner');
    const request = { root: { type: 'INCL', name: root, version: 'active' }, scope: root, context };
    const routes: Record<string, string> = {};
    for (const name of [root, child]) {
      routes[`${uri(name)}?version=active`] = metadata(name, 'PROG/I', uri(name));
      routes[`${uri(name)}/source/main/enhancements/elements?context=${contextParam}`] = empty;
    }
    routes[`${uri(child)}/source/main?version=active`] = `INCLUDE ${root}.`;
    const s = setup('sources', routes, [], request);
    await discoverSourcePlugins(s.client, s.session, request, {
      unit: { type: 'INCL', name: root },
      source: `INCLUDE ${child}.\nINCLUDE ${child}.`,
    });
    expect(s.get).toHaveBeenCalledTimes(5);
    expect(s.session.result.edges.filter((e) => e.kind === 'include')).toHaveLength(3);
  });

  it('stops hidden include reads on their deny rule and reports source units left unread', async () => {
    const s = setup('sources', rootRoutes, ['SAPRead.INCL']);
    await discoverSourcePlugins(s.client, s.session, req, {
      unit: { type: 'FUGR', name: group },
      source: 'INCLUDE ZCHILD.',
    });
    expect(s.get).toHaveBeenCalledTimes(2);
    expect(s.session.stopped).toBe(true);
    expect(s.session.result.providers[0]?.status).toBe('denied');
  });

  it('bounds depth even when every child source names another include', async () => {
    const request = { root: { type: 'PROG', name: 'ZROOT', version: 'active' }, scope: 'program' };
    const root = '/sap/bc/adt/programs/programs/zroot';
    const owner = encodeURIComponent(root);
    const routes: Record<string, string> = {
      [`${root}?version=active`]: metadata('ZROOT', 'PROG/P', root),
      [`${root}/source/main/enhancements/elements`]: empty,
    };
    for (let i = 1; i <= 6; i++) {
      const uri = `/sap/bc/adt/programs/includes/z${i}`;
      routes[`${uri}?version=active`] = metadata(`Z${i}`, 'PROG/I', uri);
      routes[`${uri}/source/main/enhancements/elements?context=${owner}`] = empty;
      routes[`${uri}/source/main?version=active`] = `INCLUDE Z${i + 1}.`;
    }
    const s = setup('sources', routes, [], request);
    await discoverSourcePlugins(s.client, s.session, request, {
      unit: { type: 'PROG', name: 'ZROOT' },
      source: 'INCLUDE Z1.',
    });
    expect(s.session.result.omissions.depth).toBe(1);
    expect(s.get.mock.calls.some((c) => c[0].includes('/z6'))).toBe(false);
  });

  it('does not parse an unbounded pre-read root body for include traversal', async () => {
    const s = setup('sources', rootRoutes);
    await discoverSourcePlugins(s.client, s.session, req, {
      unit: { type: 'FUGR', name: group },
      source: 'x'.repeat(256 * 1024 + 1),
    });
    expect(s.session.result.omissions.sources).toBe(1);
    expect(s.session.result.providers[0]?.status).toBe('incomplete');
    expect(s.get).toHaveBeenCalledTimes(2);
  });
  it('caps repeated graph occurrences through the shared edge allowance without duplicate reads', async () => {
    const uri = '/sap/bc/adt/programs/includes/zchild';
    const s = setup('sources', {
      ...rootRoutes,
      [`${uri}?version=active`]: metadata('ZCHILD', 'PROG/I', uri),
      [`${uri}/source/main/enhancements/elements?context=${encodeURIComponent(base)}`]: empty,
      [`${uri}/source/main?version=active`]: '',
    });
    await discoverSourcePlugins(s.client, s.session, req, {
      unit: { type: 'FUGR', name: group },
      source: 'INCLUDE ZCHILD.\n'.repeat(100),
    });
    expect(s.get).toHaveBeenCalledTimes(5);
    expect(s.session.result.edges).toHaveLength(80);
    expect(s.session.result.omissions.edges).toBe(20);
  });
  it.each([
    'https://evil.invalid/path',
    '/sap/bc/adt/programs/programs/wrong/source/main/enhancements/elements',
    '../source/main/enhancements/elements',
  ])('rejects unsafe/mismatched linked paths %s', (path) => {
    expect(() =>
      sourcePluginResources(
        fixture('fugr-metadata-758.xml').replace('href="source/main/enhancements/elements"', `href="${path}"`),
        { type: 'FUGR', name: group },
      ),
    ).toThrow();
  });
});
