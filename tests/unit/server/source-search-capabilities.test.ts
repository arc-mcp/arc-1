import type { BTPConfig } from '@arc-mcp/xsuaa-auth/btp';
import { afterEach, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { defaultFeatureConfig } from '../../../src/adt/config.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import * as features from '../../../src/adt/features.js';
import {
  cacheFeatureEvidence,
  getCachedFeatures,
  hasCompletedFeatureProbe,
  resetCachedFeatures,
  setCachedFeatures,
} from '../../../src/handlers/feature-cache.js';
import { handleSAPManage } from '../../../src/handlers/manage.js';
import { handleSAPSearch } from '../../../src/handlers/search.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { requestContext } from '../../../src/server/context.js';
import { ensureMultiTargetFeatureProbe } from '../../../src/server/multi-target-feature-state.js';
import { probeClientFeatures } from '../../../src/server/server.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

function exception(id: string, number: string) {
  return `<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><exc:properties>
    <exc:entry key="T100KEY-ID">${id}</exc:entry><exc:entry key="T100KEY-NO">${number}</exc:entry>
  </exc:properties></exc:exception>`;
}

const unsupported = () => features.classifyTextSearchError(403, exception('SADT_REST', '020'));
const args = { searchType: 'source_code', query: 'cl_abap_typedescr', maxResults: 3 };
const client = () =>
  ({ http: { setDiscoveryMap: vi.fn() }, searchSource: vi.fn().mockResolvedValue([]) }) as unknown as AdtClient;
const target = 'DEV/001';
const inTarget = <T>(key: string, action: () => T) =>
  requestContext.run({ requestId: 'capability-test', target: key }, action);

function mixedProbe() {
  return {
    ...features.resolveWithoutProbing(defaultFeatureConfig()),
    abapRelease: '758',
    textSearch: unsupported(),
    gcts: { id: 'gcts', mode: 'auto', available: false, message: 'forbidden (403) — user lacks authorization' },
    authProbe: { searchAccess: true, transportAccess: false, transportReason: 'forbidden (403)' },
    discoveryMap: new Map([['/sap/bc/adt/oo/classes', ['application/vnd.sap.adt.oo.classes.v4+xml']]]),
  };
}

afterEach(() => {
  resetCachedFeatures();
  vi.restoreAllMocks();
});

it('retains source-search capability despite an unrelated user authorization failure, without repeated full probes', async () => {
  const probe = vi.spyOn(features, 'probeFeatures').mockResolvedValue(mixedProbe());
  const cfg = { ...DEFAULT_CONFIG, targetId: target, ppEnabled: true };
  const sap = client();
  const invoke = () =>
    ensureMultiTargetFeatureProbe(
      target,
      hasCompletedFeatureProbe(target),
      () => probeClientFeatures(cfg, sap, {} as BTPConfig),
      () => setCachedFeatures(undefined, target),
    );
  await expect(invoke()).resolves.toBeUndefined();
  await expect(invoke()).resolves.toBeUndefined();
  expect(probe).toHaveBeenCalledTimes(1);
  expect(getCachedFeatures(target)?.textSearch).toEqual(unsupported());
  expect(getCachedFeatures(target)?.gcts).toBeUndefined();
  expect(getCachedFeatures(target)?.authProbe).toBeUndefined();
  expect(getCachedFeatures('OTHER/001')).toBeUndefined();
});

it('lets a per-user manual probe refresh safe capability facts without sharing that user’s authorization', async () => {
  vi.spyOn(features, 'probeFeatures').mockResolvedValue(mixedProbe());
  const result = await inTarget(target, () =>
    handleSAPManage(client(), { ...DEFAULT_CONFIG, ppEnabled: true }, { action: 'probe' }, undefined, true),
  );
  expect(result.isError).not.toBe(true);
  expect(getCachedFeatures(target)?.textSearch).toEqual(unsupported());
  expect(getCachedFeatures(target)?.gcts).toBeUndefined();
  expect(getCachedFeatures(target)?.authProbe).toBeUndefined();
});

it('preserves an administrator-disabled gCTS feature during a per-user manual refresh', async () => {
  vi.spyOn(features, 'probeFeatures').mockImplementation(async (_http, config) =>
    features.resolveWithoutProbing(config),
  );
  await inTarget(target, () =>
    handleSAPManage(
      client(),
      { ...DEFAULT_CONFIG, ppEnabled: true, featureGcts: 'off' },
      { action: 'probe' },
      undefined,
      true,
    ),
  );
  expect(getCachedFeatures(target)?.gcts).toMatchObject({ available: false, mode: 'off' });
});

it('learns source search is disabled lazily and avoids direct searches and repeated support probes', async () => {
  const probe = vi.spyOn(features, 'probeTextSearch').mockResolvedValue(unsupported());
  const sap = client();
  for (let i = 0; i < 2; i++) {
    const result = await inTarget(target, () => handleSAPSearch(sap, args, true));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not available');
    expect(result.content[0].text).toContain('searchType="object"');
  }
  expect(probe).toHaveBeenCalledTimes(1);
  expect(sap.searchSource).not.toHaveBeenCalled();
});

it('classifies the known disabled search framework response without making generic 500s permanent', async () => {
  vi.spyOn(features, 'probeTextSearch').mockResolvedValue({ available: true });
  const sap = client();
  vi.mocked(sap.searchSource).mockRejectedValue(
    new AdtApiError(
      'disabled',
      500,
      '/sap/bc/adt/repository/informationsystem/textsearch',
      exception('SRIS_SEARCH', '006'),
    ),
  );
  await expect(inTarget(target, () => handleSAPSearch(sap, args, true))).resolves.toMatchObject({ isError: true });
  expect(getCachedFeatures(target)?.textSearch?.available).toBe(false);

  const transient = new AdtApiError(
    'temporary failure',
    500,
    '/sap/bc/adt/repository/informationsystem/textsearch',
    '<error>temporary failure</error>',
  );
  vi.mocked(sap.searchSource).mockRejectedValue(transient);
  await expect(inTarget('OTHER/001', () => handleSAPSearch(sap, args, true))).rejects.toBe(transient);
});

it.each([401, 403, 500])('does not share an inconclusive HTTP %s support result across users', async (status) => {
  const probe = vi
    .spyOn(features, 'probeTextSearch')
    .mockResolvedValueOnce(features.classifyTextSearchError(status))
    .mockResolvedValueOnce({ available: true });
  const firstUser = client();
  vi.mocked(firstUser.searchSource).mockRejectedValue(new AdtApiError('denied', 403, '/textsearch', 'Forbidden'));
  const secondUser = client();
  await expect(inTarget(target, () => handleSAPSearch(firstUser, args, true))).resolves.toMatchObject({
    isError: true,
  });
  expect(getCachedFeatures(target)?.textSearch).toBeUndefined();
  await expect(inTarget(target, () => handleSAPSearch(secondUser, args, true))).resolves.not.toHaveProperty(
    'isError',
    true,
  );
  expect(probe).toHaveBeenCalledTimes(2);
  expect(secondUser.searchSource).toHaveBeenCalledOnce();
  expect(getCachedFeatures(target)?.textSearch?.available).toBe(true);
});

it('keeps unknown Git features visible when another capability has been learned', () => {
  const partial = { textSearch: unsupported() };
  const tools = getToolDefinitions(DEFAULT_CONFIG, false, partial);
  expect(tools.some((tool) => tool.name === 'SAPGit')).toBe(true);
  const search = tools.find((tool) => tool.name === 'SAPSearch');
  expect(search?.inputSchema).toMatchObject({
    properties: { searchType: { enum: expect.not.arrayContaining(['source_code']) } },
  });
});

it('retains explicit system type configuration and does not replace known facts with a failed refresh', () => {
  cacheFeatureEvidence({ systemType: 'btp', systemTypeSource: 'config', textSearch: unsupported() }, true, target);
  cacheFeatureEvidence({ textSearch: features.classifyTextSearchError(401) }, true, target);
  expect(getCachedFeatures(target)).toMatchObject({ systemType: 'btp', textSearch: unsupported() });
});

it.each(['network error', 'cannot determine availability (HTTP 200)'])(
  'leaves an entirely inconclusive per-user probe unknown: %s',
  (reason) => {
    cacheFeatureEvidence(
      {
        hana: { id: 'hana', available: false, mode: 'auto', message: 'forbidden (403)' },
        rap: { id: 'rap', available: false, mode: 'auto', message: reason },
        textSearch: features.classifyTextSearchError(401),
        authProbe: { searchAccess: false, transportAccess: false },
        discoveryMap: new Map(),
      },
      true,
      target,
    );
    expect(getCachedFeatures(target)).toBeUndefined();
  },
);

it.each([
  [500, 'SADT_REST', '020'],
  [403, 'SRIS_SEARCH', '006'],
  [500, 'SRIS_SEARCH', '007'],
])('does not classify a different status or T100 code as unsupported (%s/%s/%s)', (status, id, number) => {
  expect(features.classifyTextSearchError(status, exception(id, number)).unsupported).toBeUndefined();
});
