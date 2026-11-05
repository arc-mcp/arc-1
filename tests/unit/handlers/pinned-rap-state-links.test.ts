import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixture } from './pinned-ddic-harness.js';
import { bdefName, bdefOwner, config, name, nativeClient, owner, rapWorld } from './pinned-rap-harness.js';
import './setup-undici-mock.js';

const { handlePrivatePinnedRap } = await import('../../../src/handlers/write/pinned-rap.js');
const { setCachedFeatures, resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { rapHash } = await import('../../../src/adt/pinned-rap-evidence.js');
const { nativeXmlRoot } = await import('../../../src/adt/native-xml-evidence.js');
const nativeMetadata = fixture('xml/bdef-relative-state-rap.xml');
const rel = 'http://www.sap.com/adt/relations/objectstates';
const atom = 'http://www.w3.org/2005/Atom';
const actions = ['scaffold_rap_handlers', 'generate_behavior_implementation'] as const;
let state: ReturnType<typeof rapWorld>;
const call = (action: (typeof actions)[number] = actions[1], preview = false) =>
  handlePrivatePinnedRap(
    nativeClient(),
    config,
    {
      action,
      type: 'CLAS',
      name,
      bdefName,
      ...(action === actions[0] ? { autoApply: !preview } : { dryRun: preview, activate: false }),
    },
    ['write'],
  );
const body = (result: Awaited<ReturnType<typeof call>>) => JSON.parse(result.content[0].text);
const writes = () => state.sourceCalls.filter((c) => c.method !== 'GET');
const locked = () => state.world.calls.some((c) => c.path.includes('_action=LOCK'));
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  resetCachedFeatures();
  state = rapWorld();
  setCachedFeatures({ rap: { id: 'rap', available: true, mode: 'auto' } }, config.targetId);
  state.bdefVersion = 'inactive';
  state.bdefMetadataTransform = () => nativeMetadata;
});
afterEach(() => {
  expect(state.world.unexpected).toEqual([]);
  resetCachedFeatures();
  vi.restoreAllMocks();
});
it.each(actions)(
  '%s accepts the captured relative BDEF metadata in preview and actual private save',
  async (action) => {
    const source = state.bdefSource;
    const preview = await call(action, true);
    expect(preview.isError, preview.content[0].text).toBeUndefined();
    expect(state.world.calls.every((c) => c.method === 'GET')).toBe(true);
    const result = await call(action);
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(body(result).state).toBe('saved-inactive');
    expect(writes()).toHaveLength(1);
    expect(writes()[0].path).toContain(`${owner}/includes/implementations?`);
    expect(body(result).dependency).toMatchObject({
      name: bdefName,
      version: 'inactive',
      sourceHash: rapHash(source),
      metadataHash: rapHash(
        JSON.stringify(
          nativeXmlRoot(nativeMetadata, 'blueSource', 'http://www.sap.com/wbobj/blue', true).canonicalValue({}),
        ),
      ),
    });
    expect(state.bdefSource).toBe(source);
    expect(state.world.calls.filter((c) => c.path.startsWith(bdefOwner)).every((c) => c.method === 'GET')).toBe(true);
    expect(body(result).cleanup.sessionClosed).toBe(true);
  },
);
it.each([
  ['active', `./${bdefName.toLowerCase()}?version=inactive`],
  ['inactive', `${bdefOwner}/source/main?version=active`],
  ['active', `${bdefOwner}/source/main?version=inactive`],
])('accepts native %s dependency with exact alternative %s', async (version, href) => {
  state.bdefMetadataTransform = () =>
    nativeMetadata
      .replace('adtcore:version="inactive"', `adtcore:version="${version}"`)
      .replace('./zi_rap_test?version=active', href);
  const result = await call();
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(body(result).dependency.version).toBe(version);
});
it.each([
  './zother?version=active',
  '../zi_rap_test?version=active',
  './zi_rap_test/source/main?version=active',
  './ZI_RAP_TEST?version=active',
  './zi_rap_test?version=unknown',
  './zi_rap_test?version=active#fragment',
  './zi_rap_test?version=active&amp;x=1',
  './zi_rap_test?version=active&amp;version=inactive',
  './zi_rap_test?x=1&amp;version=active',
  './zi_rap_test?version=%61ctive',
  './zi_rap_test',
  '',
  'https://foreign.invalid/sap/bc/adt/bo/behaviordefinitions/zi_rap_test?version=active',
  '/sap/bc/adt/bo/behaviordefinitions/zother/source/main?version=active',
])('refuses unqualified BDEF alternative before any source write: %s', async (href) => {
  state.bdefMetadataTransform = () => nativeMetadata.replace('./zi_rap_test?version=active', href);
  const result = await call();
  expect(result.isError).toBe(true);
  expect(writes()).toEqual([]);
  expect(body(result).cleanup.sessionClosed).toBe(true);
});
it.each([
  [
    'duplicate alternatives',
    (xml: string) =>
      xml.replace(
        '</blue:blueSource>',
        `<atom:link xmlns:atom="${atom}" rel="${rel}" href="./zi_rap_test?version=inactive"/></blue:blueSource>`,
      ),
  ],
  ['missing href', (xml: string) => xml.replace('href="./zi_rap_test?version=active"', '')],
  ['wrong owner identity', (xml: string) => xml.replace('adtcore:name="ZI_RAP_TEST"', 'adtcore:name="ZI_OTHER"')],
  ['wrong native type', (xml: string) => xml.replace('adtcore:type="BDEF/BDO"', 'adtcore:type="SRVD/SRV"')],
  ['unknown version', (xml: string) => xml.replace('adtcore:version="inactive"', 'adtcore:version="unknown"')],
  ['foreign root namespace', (xml: string) => xml.replace('http://www.sap.com/wbobj/blue', 'urn:foreign')],
] as const)('refuses %s before write', async (_kind, transform) => {
  state.bdefMetadataTransform = () => transform(nativeMetadata);
  const result = await call();
  expect(result.isError).toBe(true);
  expect(writes()).toEqual([]);
  expect(body(result).cleanup.sessionClosed).toBe(true);
});
it.each(['source-read', 'before-write'])(
  'detects alternative representation drift at %s even when both forms qualify',
  async (boundary) => {
    let drift = false,
      metadataReads = 0;
    state.bdefMetadataTransform = () =>
      drift
        ? nativeMetadata.replace('./zi_rap_test?version=active', `${bdefOwner}/source/main?version=active`)
        : nativeMetadata;
    state.hook = (uri, method) => {
      if (method !== 'GET') return;
      if (boundary === 'source-read' && uri.pathname === `${bdefOwner}/source/main`) drift = true;
      if (boundary === 'before-write' && uri.pathname === bdefOwner && ++metadataReads === 3) drift = true;
    };
    const result = await call();
    expect(result.isError).toBe(true);
    expect(writes()).toEqual([]);
    expect(body(result).message).toContain(
      boundary === 'source-read' ? 'BDEF metadata changed' : 'BDEF identity, native version or source changed',
    );
    expect(locked()).toBe(true);
    expect(body(result).cleanup.sessionClosed).toBe(true);
  },
);
it.each(['class', 'include'])(
  'does not broaden the %s alternative contract to BDEF relative-owner spelling',
  async (level) => {
    state.metadataTransform = (xml) => {
      const link = `<atom:link xmlns:atom="${atom}" rel="${rel}" href="./${name.toLowerCase()}?version=active"/>`;
      return level === 'class'
        ? xml.replace('</class:abapClass>', `${link}</class:abapClass>`)
        : xml.replace(/(<class:include class:includeType="implementations"[^>]*)\/>/, `$1>${link}</class:include>`);
    };
    expect((await call()).isError).toBe(true);
    expect(writes()).toEqual([]);
    expect(locked()).toBe(false);
  },
);
