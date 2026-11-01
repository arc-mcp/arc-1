import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handlePinnedWrite } = await import('../../../src/handlers/write/pinned.js');
const policy = {
  target: 'A4H/001',
  enabled: true,
  allowedPackages: ['$TMP'],
  allowedTransports: [],
  serverAllowedTransports: [],
};
const config = {
  ...DEFAULT_CONFIG,
  targetId: 'A4H/001',
  multiTargetEndpoints: true,
  multiTargetWrite: policy,
  allowWrites: true,
  allowedPackages: ['$TMP'],
  ppEnabled: true,
  ppStrict: true,
  lintBeforeWrite: false,
};
const source =
  'CLASS zcl_test DEFINITION PUBLIC FINAL CREATE PUBLIC.\nENDCLASS.\nCLASS zcl_test IMPLEMENTATION.\nENDCLASS.\n';
beforeEach(() => vi.resetAllMocks());
it.each(['create', 'update', 'edit_method'])(
  'a pinned %s stops on one CSRF bootstrap 503 before submitting a mutation',
  async (action) => {
    const requests: { method: string; path: string }[] = [];
    mockFetch.mockImplementation(async (url: unknown, options: any = {}) => {
      const method = options.method ?? 'GET';
      const path = new URL(String(url)).pathname;
      requests.push({ method, path });
      if (method === 'HEAD') return mockResponse(503, 'busy');
      if (method === 'GET' && path === '/sap/bc/adt/oo/classes/zcl_test')
        return mockResponse(
          200,
          '<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></class:abapClass>',
        );
      throw new Error(`Unexpected ${method} ${path}`);
    });
    const client = new AdtClient({ baseUrl: 'http://sap:8000', safety: { ...defaultSafetyConfig(), ...config } });
    const result = await handlePinnedWrite(
      client,
      {
        action,
        type: 'CLAS',
        name: 'ZCL_TEST',
        source,
        ...(action === 'edit_method' ? { method: 'value' } : {}),
        ...(action === 'create' ? { package: '$TMP' } : { expectedSourceHash: sourceHash(source) }),
      },
      config,
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      state: 'unchanged',
      phase: 'recording-preflight',
      statusCode: 503,
      retryable: false,
    });
    expect(requests.filter((request) => request.method === 'HEAD')).toHaveLength(1);
    expect(requests.every((request) => ['GET', 'HEAD'].includes(request.method))).toBe(true);
  },
);
