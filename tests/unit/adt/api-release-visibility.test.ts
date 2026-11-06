import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApiReleasePutBody } from '../../../src/adt/api-release.js';
import { SAPManageSchema } from '../../../src/handlers/schemas.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from '../handlers/setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const captured = readFileSync(new URL('../../fixtures/xml/api-release-unreleased.xml', import.meta.url), 'utf8');
const cloud = captured.replace('ars:useInSAPCloudPlatformDefault="true"', 'ars:useInSAPCloudPlatformDefault="false"');
const released = (visible: boolean) =>
  cloud
    .replace(
      '<ars:status ars:state="NOT_RELEASED" ars:stateDescription="Not Released"/>',
      '<ars:status ars:state="RELEASED" ars:stateDescription="Released"/>',
    )
    .replace('ars:useInSAPCloudPlatform="false"', `ars:useInSAPCloudPlatform="${visible}"`);
const uri = '/sap/bc/adt/oo/classes/zcl_arc1_apifix';
const args = { action: 'set_api_state', objectUri: uri, apiVisibility: ['cloudDevelopment'] };
describe('explicit API-release visibility', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it('keeps native defaults when omitted but permits an explicit complete selection', () => {
    expect(buildApiReleasePutBody(cloud, 'C1', 'RELEASED')).toContain('ars:useInSAPCloudPlatform="false"');
    expect(buildApiReleasePutBody(cloud, 'C1', 'RELEASED', ['cloudDevelopment'])).toContain(
      'ars:useInSAPCloudPlatform="true"',
    );
    expect(buildApiReleasePutBody(captured, 'C1', 'RELEASED', [])).toContain('ars:useInSAPCloudPlatform="false"');
  });
  it('refuses edits to native read-only visibility and incomplete metadata', () => {
    const fixed = cloud.replaceAll(
      'ars:useInSAPCloudPlatformReadOnly="false"',
      'ars:useInSAPCloudPlatformReadOnly="true"',
    );
    expect(() => buildApiReleasePutBody(fixed, 'C1', 'RELEASED', ['cloudDevelopment'])).toThrow(/read-only/);
    expect(buildApiReleasePutBody(fixed, 'C1', 'RELEASED', [])).toContain('ars:useInSAPCloudPlatform="false"');
    expect(() =>
      buildApiReleasePutBody(cloud.replaceAll('ars:useInSAPCloudPlatformReadOnly="false"', ''), 'C1', 'RELEASED', [
        'cloudDevelopment',
      ]),
    ).toThrow(/metadata/);
  });
  it.each([
    { action: 'features' },
    { apiState: 'NOT_RELEASED' },
    { apiVisibility: ['cloudDevelopment', 'cloudDevelopment'] },
    { apiVisibility: ['unknown'] },
  ])('refuses invalid public selection %j', (patch) => {
    expect(SAPManageSchema.safeParse({ ...args, ...patch }).success).toBe(false);
  });
  it('accepts explicit empty selection and refuses it for revoke at the XML boundary', () => {
    expect(SAPManageSchema.safeParse({ ...args, apiVisibility: [] }).success).toBe(true);
    expect(() => buildApiReleasePutBody(cloud, 'C1', 'NOT_RELEASED', [])).toThrow(/requires RELEASED/);
  });
  it('passes the public selection to PUT and confirms exact readback', async () => {
    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') return mockResponse(200, '', { 'x-csrf-token': 'T' });
      const afterPut = mockFetch.mock.calls.some(([, o]) => o?.method === 'PUT');
      return mockResponse(200, url.includes('/apireleases/') ? (afterPut ? released(true) : cloud) : '<object/>', {
        'x-csrf-token': 'T',
      });
    });
    const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, systemType: 'btp' }, 'SAPManage', args);
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(String(mockFetch.mock.calls.find(([, o]) => o?.method === 'PUT')?.[1]?.body)).toContain(
      'ars:useInSAPCloudPlatform="true"',
    );
  });
  it.each([true, false])('checks explicit visibility even on a native no-op, matching=%s', async (matching) => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, released(matching), { 'x-csrf-token': 'T' }))
      .mockResolvedValueOnce(
        mockResponse(400, '<exception><message>No changes were made.</message></exception>', { 'x-csrf-token': 'T' }),
      )
      .mockResolvedValueOnce(mockResponse(200, released(matching), { 'x-csrf-token': 'T' }));
    const promise = createClient().setApiReleaseState(uri, { visibility: ['cloudDevelopment'] });
    if (matching) expect((await promise).changed).toBe(false);
    else await expect(promise).rejects.toThrow(/read-back visibility.*"changed":false/);
  });
  it.each([false, true])(
    'reports applied state and both actual visibility flags on mismatch, broader=%s',
    async (broader) => {
      const actual = released(!broader);
      mockFetch.mockImplementation(async (_url: string, opts?: RequestInit) => {
        if (opts?.method === 'PUT') return mockResponse(200, '', { 'x-csrf-token': 'T' });
        const afterPut = mockFetch.mock.calls.some(([, o]) => o?.method === 'PUT');
        return mockResponse(200, afterPut ? actual : cloud, { 'x-csrf-token': 'T' });
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        ...args,
        apiVisibility: broader ? ['cloudDevelopment'] : [],
      });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('"state":"RELEASED"');
      expect(text).toContain('"changed":true');
      expect(text).toContain(`"useInSAPCloudPlatform":${!broader}`);
      expect(text).toContain('"useInKeyUserApps":false');
      expect(text).toContain('apiState="NOT_RELEASED"');
    },
  );
  it('offers no revoke when the mismatched contract is not released', async () => {
    mockFetch.mockImplementation(async (_url: string, opts?: RequestInit) =>
      mockResponse(200, opts?.method === 'PUT' ? '' : cloud, { 'x-csrf-token': 'T' }),
    );
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', args);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('"state":"NOT_RELEASED"');
    expect(result.content[0]?.text).not.toContain('apiState="NOT_RELEASED"');
  });
  it.each([
    [true, false, 500, 'accepted'],
    [true, true, 500, 'accepted'],
    [false, false, 500, 'reported no change for'],
    [true, false, 200, 'accepted'],
  ])(
    'discloses an unconfirmed state when read-back fails, PUT applied=%s, minimal=%s, read HTTP %s',
    async (applied, minimal, readStatus, verb) => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, cloud, { 'x-csrf-token': 'T' }))
        .mockResolvedValueOnce(
          applied
            ? mockResponse(200, '', { 'x-csrf-token': 'T' })
            : mockResponse(400, '<exception><message>No changes were made.</message></exception>'),
        )
        .mockResolvedValueOnce(
          readStatus === 200
            ? mockResponse(200, '<html>Logon</html>')
            : mockResponse(500, '<exception><message>Read failed</message></exception>'),
        );
      const result = await handleToolCall(
        createClient(),
        { ...DEFAULT_CONFIG, minimalErrors: minimal },
        'SAPManage',
        args,
      );
      const text = result.content[0]?.text ?? '';
      expect(result.isError).toBe(true);
      expect(text).toContain(`SAP ${verb} the C1 RELEASED request`);
      expect(text).toContain('resulting state is unconfirmed');
      expect(text).not.toContain('Confirmed SAP result');
    },
  );
  it('drops an inapplicable strict-client selection on unrelated actions', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
      action: 'features',
      apiState: 'RELEASED',
      contract: 'C1',
      apiVisibility: [],
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(mockFetch.mock.calls.some(([, opts]) => opts?.method === 'PUT')).toBe(false);
  });
  it('drops visibility on revoke without resetting the existing visibility flags', async () => {
    mockFetch.mockImplementation(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') return mockResponse(200, '', { 'x-csrf-token': 'T' });
      const afterPut = mockFetch.mock.calls.some(([, o]) => o?.method === 'PUT');
      return mockResponse(
        200,
        afterPut
          ? cloud.replace('ars:useInSAPCloudPlatform="false"', 'ars:useInSAPCloudPlatform="true"')
          : released(true),
        { 'x-csrf-token': 'T' },
      );
    });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
      ...args,
      apiState: 'NOT_RELEASED',
      apiVisibility: [],
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const body = String(mockFetch.mock.calls.find(([, o]) => o?.method === 'PUT')?.[1]?.body);
    expect(body).toContain('ars:useInSAPCloudPlatform="true"');
    expect(body).toContain('ars:state="NOT_RELEASED"');
  });
  it('refuses a nonmatching contract before PUT', () => {
    expect(() => buildApiReleasePutBody(cloud, 'C0', 'RELEASED', ['cloudDevelopment'])).toThrow(/not available/);
  });
  it('preserves write-scope enforcement before HTTP', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', args, {
      token: 'test',
      clientId: 'reader',
      scopes: ['read'],
    });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
