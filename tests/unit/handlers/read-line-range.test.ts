import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
beforeEach(() => {
  vi.resetAllMocks();
  resetCachedFeatures();
});

describe('line-range mode boundaries', () => {
  it.each([
    { type: 'FUGR' },
    { type: 'SKTD' },
    { type: 'DOMA' },
    { type: 'TABLE_CONTENTS' },
    { type: 'CLAS', include: 'text_symbols' },
    { type: 'TABL', include: 'indexes' },
    { type: 'DDLS', include: 'elements' },
    { type: 'CLAS', format: 'structured' },
    { type: 'CLAS', format: 'editable' },
    { type: 'CLAS', action: 'diff' },
    { type: 'FUNC', includeSignature: true },
    { type: 'PROG', method: 'first' },
    { type: 'PROG', lineStart: 4, lineEnd: 2 },
    { type: 'PROG', lineStart: 0 },
  ])('refuses unsupported combination before requesting SAP: %j', async (options) => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      name: 'ZTEST',
      lineStart: 1,
      lineEnd: 2,
      ...options,
    });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps an inactive-version fallback warning outside the numbered source', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      mockResponse(200, String(url).includes('/inactiveobjects') ? '<objects/>' : 'REPORT ztest.\nWRITE 1.', {
        'x-csrf-token': 't',
      }),
    );
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'PROG',
      name: 'ZTEST',
      version: 'inactive',
      lineStart: 2,
      lineEnd: 2,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('No inactive draft exists');
    expect(result.content[0]?.text).toContain('    2: WRITE 1.');
    expect(result.content[0]?.text).not.toContain('    2: Note:');
  });
});
describe('lineStart/lineEnd', () => {
  const PROG_SRC =
    'REPORT zfoo.\nDATA lv TYPE i.\nlv = 1.\nlv = 2.\nlv = 3.\nSELECT * FROM mara INTO TABLE @lt.\nWRITE lv.';

  it('PROG lineStart/lineEnd returns only that line window, not the whole source', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse(200, PROG_SRC, { 'x-csrf-token': 't' }));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'PROG',
      name: 'ZFOO',
      lineStart: 3,
      lineEnd: 4,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('Lines 3-4 of 7 total');
    expect(result.content[0]?.text).toContain('lv = 1.');
    expect(result.content[0]?.text).toContain('lv = 2.');
    expect(result.content[0]?.text).not.toContain('REPORT zfoo');
    expect(result.content[0]?.text).not.toContain('SELECT * FROM mara');
  });

  it('requires both lineStart and lineEnd', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'PROG',
      name: 'ZFOO',
      lineStart: 3,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Both lineStart and lineEnd are required');
  });

  it('rejects lineStart/lineEnd combined with grep', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'PROG',
      name: 'ZFOO',
      lineStart: 1,
      lineEnd: 2,
      grep: 'x',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Do not combine lineStart/lineEnd with grep');
  });

  it('an out-of-range lineStart returns an error, not the full source', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse(200, PROG_SRC, { 'x-csrf-token': 't' }));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'PROG',
      name: 'ZFOO',
      lineStart: 50,
      lineEnd: 60,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('past the end of the source');
  });

  it('CLAS lineStart/lineEnd reads from the raw main section, annotated with the section label', async () => {
    const clasSrc = [
      'CLASS zcl_test DEFINITION PUBLIC.',
      '  PUBLIC SECTION.',
      '    METHODS read.',
      'ENDCLASS.',
      'CLASS zcl_test IMPLEMENTATION.',
      '  METHOD read.',
      '    SELECT * FROM mara INTO TABLE @lt.',
      '  ENDMETHOD.',
      'ENDCLASS.',
    ].join('\n');
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse(200, clasSrc, { 'x-csrf-token': 't' }));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'CLAS',
      name: 'ZCL_TEST',
      lineStart: 7,
      lineEnd: 7,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('section=main');
    expect(result.content[0]?.text).toContain('SELECT * FROM mara');
  });

  it('CLAS lineStart/lineEnd + method returns a combine error', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'CLAS',
      name: 'ZCL_TEST',
      lineStart: 1,
      lineEnd: 2,
      method: 'read',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Do not combine lineStart/lineEnd with method');
  });

  it('CLAS lineStart/lineEnd + include reads the raw section', async () => {
    const testSrc = [
      'CLASS ltcl_test DEFINITION FOR TESTING.',
      '  PRIVATE SECTION.',
      '    METHODS first_test FOR TESTING.',
      'ENDCLASS.',
      'CLASS ltcl_test IMPLEMENTATION.',
      '  METHOD first_test.',
      '    cl_abap_unit_assert=>assert_true( abap_true ).',
      '  ENDMETHOD.',
      'ENDCLASS.',
    ].join('\n');
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse(200, testSrc, { 'x-csrf-token': 't' }));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'CLAS',
      name: 'ZCL_TEST',
      lineStart: 7,
      lineEnd: 7,
      include: 'testclasses',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('section=testclasses');
    expect(result.content[0]?.text).toContain('assert_true');
    const inclCall = mockFetch.mock.calls.find((c: any[]) => String(c[0]).includes('/includes/testclasses'));
    expect(inclCall).toBeDefined();
  });

  it('works on a non-CLAS source type (BDEF)', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      mockResponse(200, 'define behavior for ZI_Foo\n{\n  create;\n  update;\n  delete;\n}', {
        'x-csrf-token': 't',
      }),
    );
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'BDEF',
      name: 'ZI_FOO',
      lineStart: 3,
      lineEnd: 3,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('create;');
  });

  it('works on a DDIC source type (TABL)', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      mockResponse(200, 'define structure zfoo {\n  field1 : abap.int4;\n  matnr : matnr;\n}', {
        'x-csrf-token': 't',
      }),
    );
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'TABL',
      name: 'ZFOO',
      lineStart: 3,
      lineEnd: 3,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('matnr');
  });
});

describe('line windows with source versions and caching', () => {
  const draft =
    '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core"><ioc:entry><ioc:object ioc:user="admin" ioc:deleted="false"><ioc:ref adtcore:uri="/sap/bc/adt/oo/classes/zcl_test" adtcore:type="CLAS/OC" adtcore:name="ZCL_TEST"/></ioc:object></ioc:entry></ioc:inactiveObjects>';

  it.each(['active', 'auto', 'inactive'] as const)('keeps %s version selection and warnings', async (version) => {
    mockFetch.mockImplementation(async (url: string) =>
      mockResponse(
        200,
        String(url).includes('/inactiveobjects') ? draft : 'CLASS zcl_test DEFINITION.\n  PUBLIC SECTION.\nENDCLASS.',
        { etag: 'e1' },
      ),
    );
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPRead',
      {
        type: 'CLAS',
        name: 'ZCL_TEST',
        include: 'main',
        version,
        lineStart: 2,
        lineEnd: 2,
      },
      undefined,
      undefined,
      new CachingLayer(new MemoryCache()),
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('    2:   PUBLIC SECTION.');
    expect(result.content[0]?.text?.includes('LAST ACTIVATED')).toBe(version === 'active');
    const sourceUrl = mockFetch.mock.calls.map((call) => String(call[0])).find((url) => url.includes('/source/main'));
    expect(sourceUrl).toContain(`version=${version === 'active' ? 'active' : 'inactive'}`);
    expect(mockFetch.mock.calls.some((call) => String(call[0]).includes('/includes/main'))).toBe(false);
  });

  it('caches the full source so a second window can read different lines after a 304', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, '<inactiveObjects/>'))
      .mockResolvedValueOnce(mockResponse(200, 'REPORT ztest.\nWRITE 1.\nWRITE 2.', { etag: 'e1' }))
      .mockResolvedValueOnce(mockResponse(304, '', { etag: 'e1' }));
    const client = createClient();
    const layer = new CachingLayer(new MemoryCache());
    for (const line of [2, 3]) {
      const result = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPRead',
        {
          type: 'PROG',
          name: 'ZTEST',
          lineStart: line,
          lineEnd: line,
        },
        undefined,
        undefined,
        layer,
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain(`    ${line}: WRITE ${line - 1}.`);
      expect(result.content[0]?.text?.startsWith('[cached:revalidated]')).toBe(line === 3);
    }
  });
});
