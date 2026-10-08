import { beforeEach, describe, expect, it } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

describe('KTD creation for SMBC parents', () => {
  beforeEach(() => mockFetch.mockReset());

  it('SKTD create routes SMBC/TYP (BCMO) parents to /bct/smbctyp', async () => {
    mockFetch.mockReset();
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string | Buffer }) => {
      calls.push({
        method: opts?.method ?? 'GET',
        url: String(url),
        body: opts?.body ? String(opts.body) : undefined,
      });
      return Promise.resolve(mockResponse(201, '<sktd:docu/>', { 'x-csrf-token': 'T' }));
    });

    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'KTD',
      name: '/LCE/SFC_XYZ_TRSHLDS',
      package: '$TMP',
      refObjectType: 'SMBC/TYP',
      refObjectDescription: 'XYZ-Schwellenwerte pflegen',
    });

    expect(result.isError).toBeUndefined();
    const postCall = calls.find(
      (c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/documentation/ktd/documents'),
    );
    expect(postCall).toBeDefined();
    expect(postCall!.body).toContain('adtcore:type="SMBC/TYP"');
    expect(postCall!.body).toContain('adtcore:uri="/sap/bc/adt/bct/smbctyp/%2Flce%2Fsfc_xyz_trshlds"');
    expect(postCall!.body).toContain('adtcore:description="XYZ-Schwellenwerte pflegen"');
  });

  it.each([undefined, '   '])(
    'SKTD create rejects an empty SMBC parent description (%s) before POST',
    async (refObjectDescription) => {
      mockFetch.mockReset();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'KTD',
        name: 'Z_BCMO_DOC',
        package: '$TMP',
        refObjectType: 'SMBC/TYP',
        refObjectDescription,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"refObjectDescription" is required for SMBC/TYP');
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['read-only', { ...unrestrictedSafetyConfig(), allowWrites: false }, 'allowWrites=false'],
    ['disallowed package', { ...unrestrictedSafetyConfig(), allowedPackages: ['Z_ALLOWED'] }, 'blocked'],
  ])('SKTD SMBC create preserves the %s safety gate', async (_label, safety, message) => {
    mockFetch.mockReset();
    const result = await handleToolCall(createClient().withSafety(safety), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'KTD',
      name: 'Z_BCMO_DOC',
      package: '$TMP',
      refObjectType: 'SMBC/TYP',
      refObjectDescription: 'Business configuration',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(message);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('SKTD create does not enable unverified SMBC subtypes', async () => {
    mockFetch.mockReset();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'KTD',
      name: 'Z_BCMO_DOC',
      package: '$TMP',
      refObjectType: 'SMBC/UNKNOWN',
      refObjectDescription: 'Business configuration',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('will not attempt unverified refObjectType "SMBC/UNKNOWN"');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
