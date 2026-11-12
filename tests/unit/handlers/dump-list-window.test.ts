import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { handleSAPDiagnose } = await import('../../../src/handlers/diagnose.js');
const { getCachedFeatures, resetCachedFeatures, setCachedFeatures } = await import(
  '../../../src/handlers/feature-cache.js'
);

// SAP_BASIS 7.50 feed: atom:updated 2026-10-24T08:19:08Z, so the older handler listed from 2026-10-23T08:19:08Z.
const feed750 = readFileSync(new URL('../../fixtures/xml/dumps-feed-nw750.xml', import.meta.url), 'utf8');
const EMPTY_FEED =
  '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:updated>2026-10-28T08:30:00Z</atom:updated></atom:feed>';
const COMPONENTS_750 =
  '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry><atom:id>SAP_BASIS</atom:id>' +
  '<atom:title>750;SAPK-75023INSAPBASIS;0023;SAP Basis Component</atom:title></atom:entry></atom:feed>';

function mockFeed(feed: string) {
  mockFetch.mockImplementation(async () => mockResponse(200, feed));
}

/** Dump feed plus the SAP_BASIS reads: components (403 when absent), no syntax configuration. */
function mockSystem(feed: string, components?: string) {
  mockFetch.mockImplementation(async (url: unknown) => {
    if (String(url).includes('/sap/bc/adt/system/components'))
      return components ? mockResponse(200, components) : mockResponse(403, 'Forbidden');
    if (String(url).includes('/sap/bc/adt/abapsource/syntax/configurations')) return mockResponse(404, 'Not Found');
    return mockResponse(200, feed);
  });
}

const componentReads = () =>
  mockFetch.mock.calls.filter(([url]) => String(url).includes('/sap/bc/adt/system/components')).length;

const list = (args: Record<string, unknown> = {}, config = DEFAULT_CONFIG) =>
  handleToolCall(createClient(), config, 'SAPDiagnose', { action: 'dumps', ...args });

beforeEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
  mockFetch.mockReset();
});

describe('SAPDiagnose dump list on a release with the 24-hour dump feed', () => {
  it('keeps the JSON array and adds the window note as a second block', async () => {
    setCachedFeatures({ abapRelease: '750' });
    mockFeed(feed750);
    const result = await list();

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);
    const dumps = JSON.parse(result.content[0]!.text);
    expect(dumps.map((dump: { error: string }) => dump.error)).toEqual([
      'DDIC_TYPE_INCONSISTENCY',
      'COMPUTE_INT_ZERODIVIDE',
    ]);
    expect(result.content[1]!.text).toContain('SAP_BASIS 7.50');
    expect(result.content[1]!.text).toContain('since 2026-10-23T08:19:08Z)');
    expect(result.content[1]!.text).not.toContain('authorization');
  });

  it('mentions authorization when the cut list is empty', async () => {
    setCachedFeatures({ abapRelease: '750' });
    mockFeed(EMPTY_FEED);
    const result = await list({ from: '2026-10-01T00:00:00Z' });

    expect(JSON.parse(result.content[0]!.text)).toEqual([]);
    expect(result.content[1]!.text).toContain('since 2026-10-27T08:30:00Z)');
    expect(result.content[1]!.text).toContain('ST22 display authorization');
  });

  it('adds nothing when from lies inside the window', async () => {
    setCachedFeatures({ abapRelease: '750' });
    mockFeed(feed750);
    const result = await list({ from: '2026-10-24T00:00:00Z' });
    expect(result.content).toHaveLength(1);
  });

  it('reads the release once as the caller when the probe has none', async () => {
    mockSystem(EMPTY_FEED, COMPONENTS_750);
    const result = await list({ from: '2026-10-01T00:00:00Z' });

    expect(result.content).toHaveLength(2);
    expect(result.content[1]!.text).toContain('SAP_BASIS 7.50');
    expect(getCachedFeatures()?.abapRelease).toBe('750');

    expect((await list({ from: '2026-10-01T00:00:00Z' })).content).toHaveLength(2);
    expect(componentReads()).toBe(1);
  });

  it('uses SAP_ABAP_RELEASE before reading the release', async () => {
    mockSystem(EMPTY_FEED, COMPONENTS_750);
    const result = await list({ from: '2026-10-01T00:00:00Z' }, { ...DEFAULT_CONFIG, abapRelease: '750' });

    expect(result.content).toHaveLength(2);
    expect(componentReads()).toBe(0);
  });
  it('does not apply a global release override to an unprobed multi-target system', async () => {
    mockSystem(EMPTY_FEED, COMPONENTS_750.replace('750;', '758;'));
    const result = await list(
      { from: '2026-10-01T00:00:00Z' },
      {
        ...DEFAULT_CONFIG,
        abapRelease: '750',
        multiTargetEndpoints: true,
        targetId: 'A4H/001',
      },
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(componentReads()).toBe(1);
  });
  it('passes cancellation and the remaining deadline to lazy release detection', async () => {
    mockSystem(EMPTY_FEED, COMPONENTS_750);
    const client = createClient();
    const get = vi.spyOn(client.http, 'get');
    const options = { signal: new AbortController().signal, deadline: Date.now() + 5000 };
    const result = await handleSAPDiagnose(client, { action: 'dumps' }, true, options);
    expect(result.isError).toBeUndefined();
    expect(get.mock.calls.find(([path]) => path.includes('/system/components'))?.[2]).toMatchObject(options);
  });

  it('adds nothing on 7.53 and later or when SAP does not report the release', async () => {
    mockSystem(EMPTY_FEED);
    expect((await list({ from: '2026-10-01T00:00:00Z' })).content).toHaveLength(1);
    expect(getCachedFeatures()?.abapRelease).toBeUndefined();

    setCachedFeatures({ abapRelease: '758' });
    expect((await list({ from: '2026-10-01T00:00:00Z' })).content).toHaveLength(1);
    expect(componentReads()).toBe(1);
  });
});
