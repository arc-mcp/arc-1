import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const badClass =
  'CLASS zcl_test DEFINITION PUBLIC. PUBLIC SECTION. METHODS run. ENDCLASS.\n' +
  'CLASS zcl_test IMPLEMENTATION. METHOD run. DATA lv_x TYPE i\nENDMETHOD. ENDCLASS.';

describe('single create lint before mutation (#942)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCachedFeatures();
    mockFetch.mockImplementation((_url, options) =>
      Promise.resolve(
        mockResponse(
          200,
          String(_url).includes('_action=LOCK')
            ? '<asx:values><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR></CORRNR></asx:values>'
            : options?.method === 'GET' || !options?.method
              ? '<object xmlns:adtcore="http://www.sap.com/adt/core" adtcore:createdBy="ADMIN"><adtcore:packageRef adtcore:name="$TMP"/></object>'
              : '',
          { 'x-csrf-token': 'T' },
        ),
      ),
    );
  });

  const mutations = () =>
    mockFetch.mock.calls.filter(([, options]) => ['POST', 'PUT', 'DELETE'].includes(options?.method ?? 'GET'));

  it.each([
    { type: 'CLAS', name: 'ZCL_TEST', package: '$TMP', source: badClass },
    { type: 'CLAS', name: 'ZCL_TEST', package: 'ZPKG', transport: 'NPLK900001', source: badClass },
    { type: 'PROG', name: 'ZTEST', package: '$TMP', source: 'REPORT ztest.\nDATA lv_x TYPE i\nWRITE lv_x.' },
  ])('rejects invalid $type in $package before creation', async (args) => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', { action: 'create', ...args });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Pre-write lint check failed');
    expect(result.content[0]?.text).not.toContain('Created');
    expect(mutations()).toEqual([]);
  });

  it('still creates valid source and writes it unchanged', async () => {
    const source = 'REPORT ztest.\nWRITE / 1.';
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'PROG',
      name: 'ZTEST',
      source,
    });
    expect(result.isError).not.toBe(true);
    expect(
      mutations().some(([url, options]) => options.method === 'POST' && String(url).includes('/programs/programs')),
    ).toBe(true);
    expect(mutations().find(([, options]) => options.method === 'PUT')?.[1].body).toBe(source);
  });

  it('still creates metadata only without a source PUT', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'CLAS',
      name: 'ZCL_TEST',
    });
    expect(result.isError).not.toBe(true);
    expect(mutations().some(([, options]) => options.method === 'POST')).toBe(true);
    expect(mutations().some(([, options]) => options.method === 'PUT')).toBe(false);
  });

  it.each([false, true])('honors per-call lintBeforeWrite=%s over the server default', async (enabled) => {
    const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, lintBeforeWrite: !enabled }, 'SAPWrite', {
      action: 'create',
      type: 'CLAS',
      name: 'ZCL_TEST',
      source: badClass,
      lintBeforeWrite: enabled,
    });
    expect(result.isError === true).toBe(enabled);
    expect(mutations().length > 0).toBe(!enabled);
  });
});
