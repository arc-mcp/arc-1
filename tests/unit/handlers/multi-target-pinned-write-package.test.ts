/**
 * ADR-0008 — the destination package allowlist and the route-bound ceiling at dispatch level.
 * A pinned PP write outside `arc1.allowed_packages`, and any write on the aggregate ceiling, must be
 * refused before ARC-1 POSTs anything to SAP. See ./setup-undici-mock.ts for the import-order rules.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { TargetDescriptor } from '../../../src/server/destination-registry.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { buildMultiTargetConfig } = await import('../../../src/server/multi-target-runtime.js');
const { targetSafety } = await import('../../../src/server/destination-registry.js');

function writableTarget(
  allowedPackages: string[],
  identity: TargetDescriptor['identity'] = 'per-user',
): TargetDescriptor {
  const policy = {
    allowDataPreview: false,
    allowFreeSQL: false,
    allowWrites: true,
    allowedPackages,
    allowTransportWrites: false,
    allowGitWrites: false,
  };
  return {
    target: 'A4H/100',
    sid: 'A4H',
    client: '100',
    description: 'A4H development',
    language: 'EN',
    destinationName: 'ARC1_A4H_100_PP',
    authentication: identity === 'per-user' ? 'PrincipalPropagation' : 'BasicAuthentication',
    identity,
    proxyType: 'OnPremise',
    hasCloudConnectorLocationId: false,
    requestedPolicy: policy,
    effectivePolicy: policy,
    connectionFingerprint: 'connection-fingerprint',
    fingerprint: 'fingerprint',
  };
}

function clientFor(target: TargetDescriptor, route: 'pinned' | 'aggregate') {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'u',
    password: 'p',
    safety: targetSafety(target, [], route),
  });
}

function classPosts(): unknown[] {
  return mockFetch.mock.calls.filter(([url, options]) => {
    const method = (options as RequestInit | undefined)?.method ?? 'GET';
    return String(url).includes('/oo/classes') && method === 'POST';
  });
}

/** Every non-GET/HEAD request that reached the mocked fetch (CSRF fetches are GETs). */
function mutatingFetches(): string[] {
  return mockFetch.mock.calls
    .map(([url, options]) => ({ url: String(url), method: (options as RequestInit | undefined)?.method ?? 'GET' }))
    .filter(({ method }) => method !== 'GET' && method !== 'HEAD')
    .map(({ url, method }) => `${method} ${url}`);
}

const ALLOW_WRITES_BLOCK =
  /Operation '[^']+' \(type [A-Z]\) is blocked by safety configuration \(reason: allowWrites=false blocks mutations \(C\/D\/U\/A\/W\/X\)\)/;

const instance = { ...DEFAULT_CONFIG, multiTargetAllowWrites: true };

describe('ADR-0008 pinned write package gate', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetCachedFeatures();
    mockFetch.mockResolvedValue(mockResponse(200, 'OK', { 'x-csrf-token': 'T' }));
  });

  it('refuses a pinned write outside arc1.allowed_packages before contacting SAP', async () => {
    const target = writableTarget(['$TMP']);
    const result = await handleToolCall(
      clientFor(target, 'pinned'),
      buildMultiTargetConfig(instance, target, 'pinned'),
      'SAPWrite',
      {
        action: 'create',
        type: 'CLAS',
        name: 'ZCL_ARC1_OTHER',
        package: 'ZOTHER',
        source: 'CLASS zcl_arc1_other DEFINITION PUBLIC. ENDCLASS. CLASS zcl_arc1_other IMPLEMENTATION. ENDCLASS.',
      },
    );
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain("Operations on package 'ZOTHER' are blocked by safety configuration (allowed: [$TMP])");
    expect(text).not.toContain('allowWrites');
    expect(classPosts()).toEqual([]);
    expect(mutatingFetches()).toEqual([]);
  });

  it('positive control: the same pinned PP write to an allowed package passes the safety gates', async () => {
    const target = writableTarget(['$TMP']);
    const result = await handleToolCall(
      clientFor(target, 'pinned'),
      buildMultiTargetConfig(instance, target, 'pinned'),
      'SAPWrite',
      {
        action: 'create',
        type: 'CLAS',
        name: 'ZCL_ARC1_TMP',
        package: '$TMP',
        source: 'CLASS zcl_arc1_tmp DEFINITION PUBLIC. ENDCLASS. CLASS zcl_arc1_tmp IMPLEMENTATION. ENDCLASS.',
      },
    );
    // May fail later on the generic mock; only the safety outcome is asserted here.
    const text = result.content[0]?.text ?? '';
    expect(text).not.toContain('blocked by safety configuration');
    expect(text).not.toContain('allowWrites=false');
  });

  it('refuses the same write on the aggregate ceiling', async () => {
    const target = writableTarget(['$TMP']);
    const result = await handleToolCall(
      clientFor(target, 'aggregate'),
      buildMultiTargetConfig(instance, target, 'aggregate'),
      'SAPWrite',
      {
        action: 'create',
        type: 'CLAS',
        name: 'ZCL_ARC1_TMP',
        package: '$TMP',
        source: 'CLASS zcl_arc1_tmp DEFINITION PUBLIC. ENDCLASS. CLASS zcl_arc1_tmp IMPLEMENTATION. ENDCLASS.',
      },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(ALLOW_WRITES_BLOCK);
    expect(classPosts()).toEqual([]);
    expect(mutatingFetches()).toEqual([]);
  });

  it('never grants a pinned write ceiling to a shared identity, even with the instance ceiling on', async () => {
    const target = writableTarget(['$TMP'], 'shared');
    const config = buildMultiTargetConfig(instance, target, 'pinned');
    expect(config.allowWrites).toBe(false);
    expect(config.allowedPackages).toEqual(['$TMP']);
    expect(targetSafety(target, [], 'pinned').allowWrites).toBe(false);

    const result = await handleToolCall(clientFor(target, 'pinned'), config, 'SAPWrite', {
      action: 'create',
      type: 'CLAS',
      name: 'ZCL_ARC1_TMP',
      package: '$TMP',
      source: 'CLASS zcl_arc1_tmp DEFINITION PUBLIC. ENDCLASS. CLASS zcl_arc1_tmp IMPLEMENTATION. ENDCLASS.',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(ALLOW_WRITES_BLOCK);
    expect(classPosts()).toEqual([]);
    expect(mutatingFetches()).toEqual([]);
  });
});
