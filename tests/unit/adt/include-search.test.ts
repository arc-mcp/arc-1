import { describe, expect, it, vi } from 'vitest';
import { filterIncludeHits, isIncludeSearchType } from '../../../src/adt/include-search.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import type { AdtSearchResult } from '../../../src/adt/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

const { AdtClient } = await import('../../../src/adt/client.js');

const hit = (objectType: string, uri: string): AdtSearchResult => ({
  objectType,
  objectName: 'X',
  description: '',
  packageName: 'ZPKG',
  uri,
});

// Shapes seen on a live 7.57 system (names anonymized): generated and F-includes live under /includes/,
// but the U-includes carry the function module URI while still being typed FUGR/I.
const FUGR_INCLUDE = hit('FUGR/I', '/sap/bc/adt/functions/groups/zgf_test/includes/lzgf_test%2401');
const FUGR_U_INCLUDE = hit('FUGR/I', '/sap/bc/adt/functions/groups/zgf_test/fmodules/zmf_xxx');
const STANDALONE = hit('PROG/I', '/sap/bc/adt/programs/includes/zincl_test');
const FUNCTION_MODULE = hit('FUGR/FF', '/sap/bc/adt/functions/groups/zgf_test/fmodules/zmf_xxx');
const ALL = [FUGR_INCLUDE, FUGR_U_INCLUDE, STANDALONE, FUNCTION_MODULE];

describe('include search filtering', () => {
  it.each([
    ['INCL', true],
    ['incl', true],
    [' FUGR/I ', true],
    ['PROG/I', true],
    ['FUGR/FF', false],
    ['CLAS', false],
    [undefined, false],
  ])('isIncludeSearchType(%j) = %s', (type, expected) => {
    expect(isIncludeSearchType(type)).toBe(expected);
  });

  it('INCL keeps both include hit types, including U-includes with a function-module URI', () => {
    expect(filterIncludeHits(ALL, 'INCL')).toEqual([FUGR_INCLUDE, FUGR_U_INCLUDE, STANDALONE]);
  });

  it('an explicit include type keeps only that type', () => {
    expect(filterIncludeHits(ALL, 'FUGR/I')).toEqual([FUGR_INCLUDE, FUGR_U_INCLUDE]);
    expect(filterIncludeHits(ALL, 'PROG/I')).toEqual([STANDALONE]);
  });

  it('leaves other types and the unfiltered case untouched', () => {
    expect(filterIncludeHits(ALL, 'FUGR/FF')).toBe(ALL);
    expect(filterIncludeHits(ALL, undefined)).toBe(ALL);
  });
});

describe('lookupObjects with an include type', () => {
  const RESPONSE = `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/functions/groups/zgf_test/includes/lzgf_testf01" adtcore:type="FUGR/I" adtcore:name="LZGF_TESTF01" adtcore:packageName="ZPKG" adtcore:description=""/>
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/programs/lzgf_testf01" adtcore:type="PROG/P" adtcore:name="LZGF_TESTF01" adtcore:packageName="ZPKG" adtcore:description=""/>
</adtcore:objectReferences>`;

  it('drops the server-side filter and filters the hits locally', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse(200, RESPONSE));
    const client = new AdtClient({
      baseUrl: 'http://sap:8000',
      username: 'admin',
      password: 'secret',
      safety: unrestrictedSafetyConfig(),
    });
    const result = await client.lookupObjects(['LZGF_TESTF01'], { objectTypes: ['INCL'] });

    expect(String(mockFetch.mock.calls[0]?.[0] ?? '')).not.toContain('objectType=');
    expect(result[0]?.matches.map((m) => m.objectType)).toEqual(['FUGR/I']);
  });
});
