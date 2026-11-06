import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { runPreWriteLint } = await import('../../../src/handlers/write-helpers.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

const permissions = String.raw`DATA request TYPE STRUCTURE FOR PERMISSIONS REQUEST zdemo_root\\root.
GET PERMISSIONS ONLY INSTANCE FEATURES ENTITY zdemo_root\\root
  FROM VALUE #( ( %key-key_field = 1 ) )
  REQUEST request
  RESULT FINAL(result)
  FAILED FINAL(failed)
  REPORTED FINAL(reported).`;

const classSource = (body: string) => `CLASS zcl_permissions DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS check_permissions.
ENDCLASS.
CLASS zcl_permissions IMPLEMENTATION.
  METHOD check_permissions.
${body}
  ENDMETHOD.
ENDCLASS.`;

beforeEach(() => {
  vi.resetAllMocks();
  resetCachedFeatures();
});

describe('GET PERMISSIONS pre-write lint (#1167)', () => {
  it.each([
    { systemType: 'onprem' as const, abapRelease: '757' },
    { systemType: 'onprem' as const, abapRelease: '758' },
    { systemType: 'btp' as const, abapRelease: undefined },
    { systemType: 'btp' as const, abapRelease: '920' },
  ])('accepts unchanged and comment-only edits on $systemType $abapRelease', (target) => {
    for (const body of [permissions, `" Documentation only\n${permissions}`]) {
      const result = runPreWriteLint(classSource(body), 'CLAS', 'ZCL_PERMISSIONS', { ...DEFAULT_CONFIG, ...target });
      expect(result.blocked, JSON.stringify(result)).toBe(false);
      expect(result.warnings ?? '').not.toContain('[parser_error]');
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses the probed release over an older configured release', () => {
    setCachedFeatures({ abapRelease: '757', systemType: 'onprem' });
    const result = runPreWriteLint(classSource(permissions), 'CLAS', 'ZCL_PERMISSIONS', {
      ...DEFAULT_CONFIG,
      systemType: 'onprem',
      abapRelease: '750',
    });
    expect(result.blocked, JSON.stringify(result)).toBe(false);
  });

  it.each([
    'GET PERMISSIONS ENTITY zdemo_root RESULT result.',
    'GET PERMISSIONS ONLY LOCAL ENTITY zdemo_root REQUEST request RESULT result.',
  ])('still blocks invalid syntax: %s', (body) => {
    for (const target of [
      { systemType: 'onprem' as const, abapRelease: '757' },
      { systemType: 'btp' as const, abapRelease: undefined },
    ]) {
      const result = runPreWriteLint(classSource(body), 'CLAS', 'ZCL_PERMISSIONS', { ...DEFAULT_CONFIG, ...target });
      expect(result.blocked).toBe(true);
      expect(result.result?.content[0]?.text).toContain('[parser_error]');
    }
  });

  it('keeps an older unsupported dialect blocking', () => {
    const result = runPreWriteLint(classSource(permissions), 'CLAS', 'ZCL_PERMISSIONS', {
      ...DEFAULT_CONFIG,
      systemType: 'onprem',
      abapRelease: '750',
    });
    expect(result.blocked).toBe(true);
    expect(result.result?.content[0]?.text).toContain('[parser_error]');
  });

  it('passes the unchanged program body through the real update handler', async () => {
    const client = createClient();
    vi.spyOn(client, 'resolveObjectPackage').mockResolvedValue('$TMP');
    mockFetch.mockImplementation((url: string | URL) =>
      Promise.resolve(
        mockResponse(
          200,
          String(url).includes('_action=LOCK')
            ? '<asx:values><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR></CORRNR></asx:values>'
            : '<ok/>',
          { 'x-csrf-token': 'T' },
        ),
      ),
    );
    const source = `REPORT zpermissions.\n" Documentation only\n${permissions}`;
    const result = await handleToolCall(
      client,
      { ...DEFAULT_CONFIG, systemType: 'onprem', abapRelease: '757' },
      'SAPWrite',
      {
        action: 'update',
        type: 'PROG',
        name: 'ZPERMISSIONS',
        source,
      },
    );
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const writes = mockFetch.mock.calls.filter(([, opts]) => opts?.method === 'PUT');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[1]?.body).toBe(source);
  });
});
