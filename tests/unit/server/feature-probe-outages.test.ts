import { afterEach, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { Semaphore } from '../../../src/adt/semaphore.js';
import {
  getCachedFeatures,
  hasCompletedFeatureProbe,
  resetCachedFeatures,
  setCachedFeatures,
} from '../../../src/handlers/feature-cache.js';
import { handleSAPManage } from '../../../src/handlers/manage.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { ensureMultiTargetFeatureProbe } from '../../../src/server/multi-target-feature-state.js';
import { probeClientFeatures } from '../../../src/server/server.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.mock('undici', async (original) => ({ ...(await original<typeof import('undici')>()), fetch: mockFetch }));

const components = '<feed><entry><id>SAP_BASIS</id><title>758;SAPK-75802;0002;SAP Basis</title></entry></feed>';
const discovery =
  '<app:service><app:workspace><app:collection href="/sap/bc/adt/oo/classes"/></app:workspace></app:service>';
const featureIds = ['hana', 'abapGit', 'gcts', 'rap', 'amdp', 'ui5', 'transport', 'ui5repo', 'flp'] as const;

function client(host = 'sap', semaphore?: Semaphore) {
  return new AdtClient({
    baseUrl: `https://${host}.example.test`,
    username: 'TEST_USER',
    password: 'test-only',
    client: '001',
    adtSemaphore: semaphore,
  });
}

function healthy(path: string) {
  if (path === '/sap/bc/adt/system/components') return mockResponse(200, components);
  if (path.endsWith('/discovery')) return mockResponse(200, discovery);
  if (path === '/sap/bc/adt/ddic/ddl/sources') return mockResponse(200, '<root/>');
  return mockResponse(404, '<error>Not found</error>');
}

function outage(status = 503, retryAfter = '0') {
  return mockResponse(status, '<html>Gateway unavailable</html>', {
    'content-type': 'text/html',
    'retry-after': retryAfter,
  });
}

function invoke(sap: AdtClient, target: string) {
  return ensureMultiTargetFeatureProbe(
    target,
    hasCompletedFeatureProbe(target),
    () => probeClientFeatures({ ...DEFAULT_CONFIG, targetId: target, systemType: 'onprem' }, sap),
    () => setCachedFeatures(undefined, target),
  );
}

afterEach(() => {
  resetCachedFeatures();
  mockFetch.mockReset();
});

it.each([502, 503, 504])(
  'keeps HTML HTTP %i inconclusive with one send per discovered-target probe',
  async (status) => {
    mockFetch.mockImplementation(async () => outage(status));
    await invoke(client(), 'DEV/001');
    expect(hasCompletedFeatureProbe('DEV/001')).toBe(false);
    for (const id of featureIds) expect(getCachedFeatures('DEV/001')?.[id]).toBeUndefined();
    expect(getCachedFeatures('DEV/001')).not.toHaveProperty('releaseProbePending');
    expect(mockFetch).toHaveBeenCalledTimes(15);
    expect(mockFetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  },
);

it('coalesces an unavailable target while another target completes through the shared semaphore', async () => {
  mockFetch.mockImplementation(async (input) => {
    const url = new URL(String(input));
    return url.hostname.startsWith('down.') ? outage(503, '60') : healthy(url.pathname);
  });
  const semaphore = new Semaphore(2);
  const down = client('down', semaphore);
  const up = client('up', semaphore);
  await Promise.all([invoke(down, 'DOWN/001'), invoke(down, 'DOWN/001'), invoke(up, 'UP/001')]);
  expect(hasCompletedFeatureProbe('DOWN/001')).toBe(false);
  expect(getCachedFeatures('DOWN/001')?.abapRelease).toBeUndefined();
  expect(hasCompletedFeatureProbe('UP/001')).toBe(true);
  expect(getCachedFeatures('UP/001')?.abapRelease).toBe('758');
  const sends = mockFetch.mock.calls.map(([input]) => new URL(String(input)));
  expect(sends.filter((url) => url.hostname.startsWith('down.'))).toHaveLength(15);
  expect(sends.filter((url) => url.hostname.startsWith('up.') && url.pathname.endsWith('/components'))).toHaveLength(1);
  const count = mockFetch.mock.calls.length;
  await invoke(up, 'UP/001');
  expect(mockFetch).toHaveBeenCalledTimes(count);
});

it('completes with a known release while leaving an unrelated unavailable feature unknown', async () => {
  mockFetch.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    return path.endsWith('/abapgit/repos') ? outage() : healthy(path);
  });
  await invoke(client(), 'DEV/001');
  expect(hasCompletedFeatureProbe('DEV/001')).toBe(true);
  expect(getCachedFeatures('DEV/001')?.abapRelease).toBe('758');
  expect(getCachedFeatures('DEV/001')?.abapGit).toBeUndefined();
});

it('preserves known capabilities and real absences when a manual refresh encounters an outage', async () => {
  const sap = client();
  mockFetch.mockImplementation(async (input) => healthy(new URL(String(input)).pathname));
  await probeClientFeatures(DEFAULT_CONFIG, sap);
  expect(getCachedFeatures()?.abapGit?.available).toBe(false);
  mockFetch.mockImplementation(async () => outage());
  await handleSAPManage(sap, DEFAULT_CONFIG, { action: 'probe' });
  expect(getCachedFeatures()?.abapRelease).toBe('758');
  expect(getCachedFeatures()?.rap?.available).toBe(true);
  expect(getCachedFeatures()?.abapGit?.available).toBe(false);
  expect(getCachedFeatures()).not.toHaveProperty('releaseProbePending');
  expect(hasCompletedFeatureProbe()).toBe(true);
});

it('keeps single-target startup retry behavior and allows a manual probe after recovery', async () => {
  const sap = client();
  mockFetch.mockImplementation(async () => outage());
  await probeClientFeatures(DEFAULT_CONFIG, sap);
  expect(mockFetch).toHaveBeenCalledTimes(30);
  expect(hasCompletedFeatureProbe()).toBe(false);
  expect(
    getToolDefinitions(DEFAULT_CONFIG, undefined, getCachedFeatures()).some((tool) => tool.name === 'SAPGit'),
  ).toBe(true);
  mockFetch.mockImplementation(async (input) => healthy(new URL(String(input)).pathname));
  const result = await handleSAPManage(sap, DEFAULT_CONFIG, { action: 'probe' });
  expect(result.isError).not.toBe(true);
  expect(getCachedFeatures()?.abapRelease).toBe('758');
  expect(hasCompletedFeatureProbe()).toBe(true);
});

it.each([429, 500])('preserves HTTP %i recovery while disabling only unavailable-service replay', async (status) => {
  let componentSends = 0;
  mockFetch.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === '/sap/bc/adt/system/components' && ++componentSends === 1)
      return mockResponse(status, 'database connection is not open', { 'retry-after': '0' });
    return healthy(path);
  });
  await invoke(client(), 'DEV/001');
  expect(componentSends).toBe(2);
  expect(hasCompletedFeatureProbe('DEV/001')).toBe(true);
  expect(getCachedFeatures('DEV/001')?.abapRelease).toBe('758');
});

it('accepts a successful syntax fallback after the components endpoint has a gateway failure', async () => {
  const syntax = `<abapsource:syntaxConfigurations xmlns:abapsource="http://www.sap.com/adt/abapsource">
    <abapsource:syntaxConfiguration><abapsource:language><abapsource:version>X</abapsource:version>
    <atom:link xmlns:atom="http://www.w3.org/2005/Atom" etag="758"
      rel="http://www.sap.com/adt/relations/abapsource/parser"/>
    </abapsource:language></abapsource:syntaxConfiguration></abapsource:syntaxConfigurations>`;
  mockFetch.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/components')) return outage();
    if (path.endsWith('/syntax/configurations')) return mockResponse(200, syntax);
    return healthy(path);
  });
  await invoke(client(), 'DEV/001');
  expect(hasCompletedFeatureProbe('DEV/001')).toBe(true);
  expect(getCachedFeatures('DEV/001')?.abapRelease).toBe('758');
  expect(getCachedFeatures('DEV/001')).not.toHaveProperty('releaseProbePending');
});
