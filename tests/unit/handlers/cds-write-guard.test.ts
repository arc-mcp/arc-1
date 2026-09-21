/** CDS pre-write release guard tests, including issue #692 table-function coverage. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

describe('CDS pre-write validation (table entity version guard)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCachedFeatures();
    mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
  });

  afterEach(() => {
    resetCachedFeatures();
  });

  it('rejects "define table entity" on SAP_BASIS 756', async () => {
    setCachedFeatures({ ...featuresOff(), abapRelease: '756', systemType: 'onprem' });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'DDLS',
      name: 'ZI_FOOTBALL',
      source: 'define table entity ZI_Football {\n  key id : abap.int4;\n  name : abap.char(40);\n}',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('define table entity');
    expect(result.content[0]?.text).toContain('757');
    expect(result.content[0]?.text).toContain('756');
  });

  it('allows "define table entity" on BTP', async () => {
    setCachedFeatures({ ...featuresOff(), abapRelease: '756', systemType: 'btp' });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'DDLS',
      name: 'ZI_FOOTBALL',
      source: 'define table entity ZI_Football {\n  key id : abap.int4;\n}',
      description: 'Football entity',
    });
    if (result.isError) expect(result.content[0]?.text).not.toContain('define table entity');
  });

  it('allows "define table entity" on SAP_BASIS 757+', async () => {
    setCachedFeatures({ ...featuresOff(), abapRelease: '757', systemType: 'onprem' });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'DDLS',
      name: 'ZI_FOOTBALL',
      source: 'define table entity ZI_Football {\n  key id : abap.int4;\n}',
      description: 'Football entity',
    });
    if (result.isError) expect(result.content[0]?.text).not.toContain('define table entity');
  });

  it('proceeds without blocking when cachedFeatures is not available', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'DDLS',
      name: 'ZI_FOOTBALL',
      source: 'define table entity ZI_Football {\n  key id : abap.int4;\n}',
      description: 'Football entity',
    });
    if (result.isError) expect(result.content[0]?.text).not.toContain('define table entity');
  });

  it('rejects "define table entity" in update path on old release', async () => {
    setCachedFeatures({ ...featuresOff(), abapRelease: '750', systemType: 'onprem' });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'DDLS',
      name: 'ZI_FOOTBALL',
      source: 'define table entity ZI_Football {\n  key id : abap.int4;\n}',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('define table entity');
    expect(result.content[0]?.text).toContain('750');
  });

  it('allows "define table function" in create and update paths on SAP_BASIS 750', async () => {
    setCachedFeatures({ ...featuresOff(), abapRelease: '750', systemType: 'onprem' });
    mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
    const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
    const source = `@EndUserText.label: 'Issue 692'
define table function ZI_692_TF
returns { CARRID: s_carr_id; }
implemented by method ZCL_692_AMDP=>GET_DATA`;

    const createResult = await handleToolCall(createClient(), config, 'SAPWrite', {
      action: 'create',
      type: 'DDLS',
      name: 'ZI_692_TF',
      package: '$TMP',
      source,
    });
    expect(createResult.content[0]?.text).not.toContain('define table entity');
    expect(
      mockFetch.mock.calls.some(
        ([url, options]) =>
          new URL(String(url)).pathname === '/sap/bc/adt/ddic/ddl/sources' &&
          (options as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true);

    mockFetch.mockClear();
    const updateResult = await handleToolCall(createClient(), config, 'SAPWrite', {
      action: 'update',
      type: 'DDLS',
      name: 'ZI_692_TF',
      source,
    });
    expect(updateResult.content[0]?.text).not.toContain('define table entity');
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('_action=LOCK'))).toBe(true);
  });

  it('allows "define table function" in batch_create on SAP_BASIS 750', async () => {
    setCachedFeatures({ ...featuresOff(), abapRelease: '750', systemType: 'onprem' });
    mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));

    const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, lintBeforeWrite: false }, 'SAPWrite', {
      action: 'batch_create',
      package: '$TMP',
      objects: [
        {
          type: 'DDLS',
          name: 'ZI_692_TF',
          source:
            "@EndUserText.label: 'Issue 692'\ndefine table function ZI_692_TF\nreturns { CARRID: s_carr_id; }\nimplemented by method ZCL_692_AMDP=>GET_DATA",
        },
      ],
    });

    expect(result.content[0]?.text).not.toContain('define table entity');
    expect(
      mockFetch.mock.calls.some(
        ([url, options]) =>
          new URL(String(url)).pathname === '/sap/bc/adt/ddic/ddl/sources' &&
          (options as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('rejects "define table entity" in batch_create on SAP_BASIS 750 before create', async () => {
    setCachedFeatures({ ...featuresOff(), abapRelease: '750', systemType: 'onprem' });
    mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));

    const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, lintBeforeWrite: false }, 'SAPWrite', {
      action: 'batch_create',
      package: '$TMP',
      objects: [
        {
          type: 'DDLS',
          name: 'ZI_692_ENTITY',
          source: 'define table entity ZI_692_ENTITY { key id : abap.int4; }',
        },
      ],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('define table entity');
    expect(result.content[0]?.text).toContain('750');
    expect(
      mockFetch.mock.calls.some(
        ([url, options]) =>
          new URL(String(url)).pathname === '/sap/bc/adt/ddic/ddl/sources' &&
          (options as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false);
  });
});
