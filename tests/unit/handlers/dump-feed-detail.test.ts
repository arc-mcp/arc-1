import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

// SAP_BASIS 7.50: /runtime/dump/{id} is not registered, the dump feed carries an HTML summary per entry.
const feed750 = readFileSync(new URL('../../fixtures/xml/dumps-feed-nw750.xml', import.meta.url), 'utf8');
const DUMP_ID =
  '20261024092105vhcalnplci_NPL_00%20%20%20%20%20%20%20%20%20%20%20%20%20%20%20DEVELOPER%20%20%20001%20%20%20%20%20%20%2012';

function mock750(feed = feed750) {
  mockFetch.mockImplementation(async (url: string | URL) => {
    const path = new URL(String(url)).pathname;
    if (path.startsWith('/sap/bc/adt/runtime/dump/')) return mockResponse(404, '<html>not found</html>');
    return mockResponse(200, feed);
  });
}

const call = (args: Record<string, unknown>, config = DEFAULT_CONFIG) =>
  handleToolCall(createClient(), config, 'SAPDiagnose', { action: 'dumps', ...args });

beforeEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
  mockFetch.mockReset();
});

describe('SAPDiagnose dump detail without an ADT dump-detail resource (SAP_BASIS 7.50)', () => {
  it('returns the whole feed summary, marked as such, by default', async () => {
    mock750();
    const result = await call({ id: DUMP_ID });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toMatchObject({
      id: DUMP_ID,
      error: 'COMPUTE_INT_ZERODIVIDE',
      exception: 'CX_SY_ZERODIVIDE',
      program: 'ZARC1_E2E_DUMP',
      origin: 'feed-summary',
    });
    expect(parsed.note).toContain('ST22');
    expect(parsed.selectedSectionIds).toEqual(['HEADER', 'WHATHAPPENED', 'ERROR', 'TERMINATION', 'SOURCE', 'STACK']);
    expect(parsed.sections.SOURCE).toContain('>>>>>     8   lv_result = 1 / lv_zero.');
    expect(parsed).not.toHaveProperty('formattedText');
  });

  it('selects sections by id or SAP title and adds the full text on request', async () => {
    mock750();
    const result = await call({ id: DUMP_ID, sections: ['SOURCE', 'What happened?'], includeFullText: true });

    const parsed = JSON.parse(result.content[0]!.text);
    expect(Object.keys(parsed.sections)).toEqual(['SOURCE', 'WHATHAPPENED']);
    expect(parsed.formattedText).toContain('Active Calls/Events');
  });

  it('explains the 24-hour feed even with minimal errors when the feed does not list the dump', async () => {
    mock750('<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>');
    const result = await call({ id: DUMP_ID }, { ...DEFAULT_CONFIG, minimalErrors: true });

    expect(result.isError).toBe(true);
    const text = result.content[0]!.text;
    expect(text).toContain('status 404');
    expect(text).toContain('last 24 hours');
    expect(text).not.toContain('not found</html>');
  });

  it('reports incomplete feed lookup with minimal errors', async () => {
    mock750('<feed><entry><title>Unreadable dump identity</title></entry></feed>');
    const result = await call({ id: DUMP_ID }, { ...DEFAULT_CONFIG, minimalErrors: true });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('incomplete');
    expect(result.content[0]!.text).not.toContain('does not list');
  });

  it('reports the response limit with minimal errors', async () => {
    mock750(' '.repeat(4 * 1024 * 1024 + 1));
    const result = await call({ id: DUMP_ID }, { ...DEFAULT_CONFIG, minimalErrors: true });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('DATA_RESPONSE_TOO_LARGE');
    expect(result.content[0]!.text).not.toContain('status 404');
  });

  it('refuses a denied dump action before any detail or feed request', async () => {
    mock750();
    const result = await call({ id: DUMP_ID }, { ...DEFAULT_CONFIG, denyActions: ['SAPDiagnose.dumps'] });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
