/**
 * SAPManage create_package — BTP cloud path unit tests.
 * Verifies the cloud body (internal-user responsible, ZLOCAL software component, recordChanges
 * false) and the responsible resolution-chain guards. Uses superPackage="$TMP" so the transport
 * pre-flight is skipped (the handler short-circuits it for $TMP). Live evidence:
 * docs/research/2026-06-27-btp-package-create-solved.md.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const BTP_CONFIG = { ...DEFAULT_CONFIG, systemType: 'btp' as const };

function packagePostBody(): string | undefined {
  const call = mockFetch.mock.calls.find(
    ([url, opts]) =>
      String(url).includes('/sap/bc/adt/packages') && (opts as RequestInit | undefined)?.method === 'POST',
  );
  return call ? String((call[1] as RequestInit).body) : undefined;
}
const resultText = (res: { content: Array<{ text?: string }> }): string => res.content[0]?.text ?? '';

describe('SAPManage create_package — BTP cloud path', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockResolvedValue(mockResponse(200, '<ok/>', { 'x-csrf-token': 'mock-csrf-token' }));
  });

  it('builds a cloud body (internal-user responsible, ZLOCAL SC, recordChanges false) when systemType=btp', async () => {
    const client = createClient();
    client.noteInternalUser('CB9980000000');
    const res = await handleToolCall(client, BTP_CONFIG, 'SAPManage', {
      action: 'create_package',
      name: 'ZARC1_SUB',
      description: 'Cloud sub-package',
      superPackage: '$TMP',
    });
    expect(res.isError).toBeFalsy();
    const body = packagePostBody();
    expect(body).toBeDefined();
    expect(body).toContain('adtcore:responsible="CB9980000000"');
    expect(body).toContain('<pak:softwareComponent pak:name="ZLOCAL"/>');
    expect(body).toContain('pak:recordChanges="false"');
    expect(body).not.toContain('@'); // never the IAS email
  });

  it('cloud bypasses the transport pre-flight for a non-$TMP superPackage (no /cts/ call)', async () => {
    // Regression (live-caught): the on-prem transport pre-flight GETs /cts/transportrequests and
    // wrongly demands a transport for ZLOCAL on BTP. Cloud packages under the local SC need none.
    const client = createClient();
    client.noteInternalUser('CB9980000000');
    const res = await handleToolCall(client, BTP_CONFIG, 'SAPManage', {
      action: 'create_package',
      name: 'ZARC1_SUB',
      description: 'Cloud sub-package under a structure package',
      superPackage: 'ZLOCAL',
    });
    expect(res.isError).toBeFalsy();
    const ctsCalls = mockFetch.mock.calls.filter(([url]) => String(url).includes('/cts/'));
    expect(ctsCalls).toHaveLength(0);
    expect(packagePostBody()).toContain('<pak:superPackage adtcore:name="ZLOCAL"/>');
  });

  it('uses an explicit responsible arg over the cache', async () => {
    const client = createClient();
    client.noteInternalUser('CB0000000001');
    const res = await handleToolCall(client, BTP_CONFIG, 'SAPManage', {
      action: 'create_package',
      name: 'ZARC1_SUB2',
      description: 'd',
      superPackage: '$TMP',
      responsible: 'CB9980000000',
    });
    expect(res.isError).toBeFalsy();
    expect(packagePostBody()).toContain('adtcore:responsible="CB9980000000"');
  });

  it('FAILS (no package POST) when superPackage is missing on BTP', async () => {
    const client = createClient();
    client.noteInternalUser('CB9980000000');
    const res = await handleToolCall(client, BTP_CONFIG, 'SAPManage', {
      action: 'create_package',
      name: 'ZARC1_ROOT',
      description: 'd',
    });
    expect(res.isError).toBe(true);
    expect(resultText(res)).toMatch(/structure package|superPackage/i);
    expect(packagePostBody()).toBeUndefined();
  });

  it('FAILS when the internal user is unresolved (no cache, no arg)', async () => {
    const client = createClient(); // no noteInternalUser
    const res = await handleToolCall(client, BTP_CONFIG, 'SAPManage', {
      action: 'create_package',
      name: 'ZARC1_X',
      description: 'd',
      superPackage: '$TMP',
    });
    expect(res.isError).toBe(true);
    expect(resultText(res)).toMatch(/internal ABAP user|responsible/i);
    expect(packagePostBody()).toBeUndefined();
  });

  it('FAILS (and never sends the email) when responsible is an email', async () => {
    const client = createClient();
    const res = await handleToolCall(client, BTP_CONFIG, 'SAPManage', {
      action: 'create_package',
      name: 'ZARC1_Y',
      description: 'd',
      superPackage: '$TMP',
      responsible: 'marian@zeis.de',
    });
    expect(res.isError).toBe(true);
    expect(packagePostBody()).toBeUndefined();
  });

  it('on-prem (non-bearer, systemType auto) keeps the legacy LOCAL body — no cloud transform', async () => {
    const client = createClient();
    const res = await handleToolCall(client, DEFAULT_CONFIG, 'SAPManage', {
      action: 'create_package',
      name: 'ZPKG_OP',
      description: 'd',
      superPackage: '$TMP',
    });
    expect(res.isError).toBeFalsy();
    expect(packagePostBody()).toContain('<pak:softwareComponent pak:name="LOCAL"/>');
  });
});
