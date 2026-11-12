import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdtSearchResult } from '../../../src/adt/types.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const hit = (objectType: string, objectName = 'ZINCLUDE'): AdtSearchResult => ({
  objectType,
  objectName,
  description: '',
  packageName: '$TMP',
  uri: `/sap/bc/adt/programs/includes/${objectName.toLowerCase()}`,
});

// Honor SAP's requested limit: a test that always returns every row cannot catch early truncation.
function serve(hits: AdtSearchResult[]) {
  mockFetch.mockImplementation(async (url: string) => {
    const params = new URL(String(url)).searchParams;
    const type = params.get('objectType');
    const rows = hits.filter((r) => !type || r.objectType === type).slice(0, Number(params.get('maxResults')));
    return mockResponse(
      200,
      `<objectReferences>${rows
        .map((r) => `<objectReference type="${r.objectType}" name="${r.objectName}" uri="${r.uri}"/>`)
        .join('')}</objectReferences>`,
    );
  });
}

async function lookup(args: Record<string, unknown>, client = createClient()) {
  const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPSearch', {
    searchType: 'tadir_lookup',
    names: ['ZINCLUDE'],
    ...args,
  });
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0].text);
}

beforeEach(() => vi.resetAllMocks());

describe('include lookup at the tool boundary', () => {
  it.each(['objectType', 'objectTypes'])('preserves a requested subtype via %s', async (field) => {
    for (const actual of ['FUGR/I', 'PROG/I']) {
      serve([hit(actual)]);
      for (const wanted of ['INCL', 'FUGR/I', 'PROG/I']) {
        const result = await lookup({
          [field]: field === 'objectTypes' ? [wanted.toLowerCase()] : wanted.toLowerCase(),
        });
        const present = wanted === 'INCL' || actual === wanted;
        expect(result.lookups[0].found).toBe(present);
        expect(result.lookups[0].matches.map((r: AdtSearchResult) => r.objectType)).toEqual(present ? [actual] : []);
        expect(result.missing).toEqual(present ? [] : ['ZINCLUDE']);
      }
    }
  });

  it('finds an exact include behind another same-name object when maxResults is one', async () => {
    serve([hit('TABL/DS'), hit('FUGR/I')]);
    const result = await lookup({ objectType: 'INCL', maxResults: 1 });
    expect(result.lookups[0].matches).toEqual([
      expect.objectContaining({ objectName: 'ZINCLUDE', objectType: 'FUGR/I' }),
    ]);
    expect(result.missing).toEqual([]);
    expect(new URL(String(mockFetch.mock.calls[0][0])).searchParams.get('maxResults')).toBe('1000');
  });

  it('retains DB type normalization separately from ADT include subtypes', async () => {
    const client = createClient();
    const db = vi.spyOn(client, 'lookupObjectsViaDb').mockResolvedValue([]);
    await lookup({ objectType: 'PROG/I', source: 'db' }, client);
    expect(db).toHaveBeenCalledWith(['ZINCLUDE'], { maxResults: 100, objectTypes: ['INCL'] });
  });
});

describe('include object search bounds and errors', () => {
  it.each([0, -1])('keeps the normal default limit for maxResults=%s', async (maxResults) => {
    serve(Array.from({ length: 110 }, (_, i) => hit('FUGR/I', `INC_${i}`)));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
      query: 'INC*',
      objectType: 'INCL',
      maxResults,
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toHaveLength(100);
  });

  it('does not blame a type filter that was never sent when SAP returns 406', async () => {
    mockFetch.mockResolvedValue(mockResponse(406, 'No compatible representation'));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
      query: 'Z*',
      objectType: 'INCL',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain('explicitly omit objectType');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

it('retains the working native PROG/I filter and requested search limit', async () => {
  serve([hit('PROG/I')]);
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
    query: 'Z*',
    objectType: 'PROG/I',
    maxResults: 7,
  });
  expect(result.isError).toBeUndefined();
  const params = new URL(String(mockFetch.mock.calls[0][0])).searchParams;
  expect(params.get('objectType')).toBe('PROG/I');
  expect(params.get('maxResults')).toBe('7');
});
