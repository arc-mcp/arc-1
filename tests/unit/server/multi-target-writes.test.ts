import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { describe, expect, it } from 'vitest';
import { checkPackage, checkTransport, defaultSafetyConfig } from '../../../src/adt/safety.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { DestinationRegistry } from '../../../src/server/destination-registry.js';
import { parseTargetGrant } from '../../../src/server/multi-target-authorization.js';
import { parseDestinationAllowlist } from '../../../src/server/multi-target-destination-config.js';
import { projectMultiTargetRequest } from '../../../src/server/multi-target-request-projection.js';
import { buildMultiTargetConfig } from '../../../src/server/multi-target-runtime.js';
import { prepareMultiTargetCall } from '../../../src/server/multi-target-server.js';
import { multiTargetToolDefinitions } from '../../../src/server/multi-target-tools.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const base = {
  ...DEFAULT_CONFIG,
  multiTargetEndpoints: true,
  multiTargetAuthorization: 'xsuaa-attribute' as const,
  allowWrites: true,
  allowedPackages: ['ZGLOBAL*', '$TMP'],
};
function registry(properties: Record<string, string> = {}, config = base, auth = 'PrincipalPropagation') {
  return DestinationRegistry.fromDiscovery(
    {
      subaccount: [
        {
          name: 'TEST_PP',
          type: 'HTTP',
          urlState: 'valid',
          urlFingerprint: 'test',
          authentication: auth,
          proxyType: 'OnPremise',
          sapSysId: 'A4H',
          sapClient: '001',
          description: 'Test',
          hasCloudConnectorLocationId: false,
          arcProperties: {
            'arc1.enabled': 'true',
            'arc1.allow_writes': 'true',
            'arc1.allowed_packages': '$TMP,ZGLOBAL_TEAM/**',
            ...properties,
          },
        },
      ],
      instanceNames: [],
      scannedCount: 1,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    config,
  );
}
function auth(write: unknown = ['A4H/001'], raw = ['read', 'write']): AuthInfo {
  return {
    token: 'verified-test',
    clientId: 'test',
    scopes: ['read', 'write', 'admin'],
    extra: {
      arc1VerifiedRawScopes: raw,
      xsuaaUserAttributes: { arc1_targets: ['*'], arc1_write_targets: write },
      xsuaaUserAttributeStatus: { arc1_targets: 'valid', arc1_write_targets: 'valid' },
    },
  };
}
function runtime(identity = auth(), mode: 'pinned' | 'aggregate' = 'pinned') {
  const r = registry();
  return buildMultiTargetConfig(base, r.targets[0], { mode, authorization: projectMultiTargetRequest(r, identity) });
}

describe('pinned write policy composition', () => {
  it('requires both raw write scope and exact capability grant, including for admin', () => {
    expect(runtime().allowWrites).toBe(true);
    for (const identity of [
      auth([], ['write']),
      auth(['A4H/100']),
      auth(['*']),
      auth(['A4H/001'], ['admin']),
      auth(['A4H/001'], ['read']),
    ])
      expect(runtime(identity).allowWrites).toBe(false);
    expect(runtime(auth(), 'aggregate').allowWrites).toBe(false);
    expect(runtime().allowedPackages).toEqual(base.allowedPackages);
  });
  it.each(['aggregate', 'reader', 'writer', 'basic'] as const)(
    'keeps server transport write restrictions out of %s reads',
    (kind) => {
      const instance = { ...base, allowedTransports: ['A4HK900001'], multiTargetAllowBasicAuth: true };
      const r = registry(
        kind === 'basic' ? { 'arc1.allow_writes': 'false' } : {},
        instance,
        kind === 'basic' ? 'BasicAuthentication' : 'PrincipalPropagation',
      );
      const identity = kind === 'reader' ? auth([], ['read']) : auth();
      const cfg = buildMultiTargetConfig(instance, r.targets[0], {
        mode: kind === 'aggregate' ? 'aggregate' : 'pinned',
        authorization: projectMultiTargetRequest(r, identity),
      });
      expect(() =>
        checkTransport({ ...defaultSafetyConfig(), ...cfg }, 'A4HK999999', 'GetTransport', false),
      ).not.toThrow();
      if (kind === 'writer') expect(cfg.multiTargetWrite?.serverAllowedTransports).toEqual(instance.allowedTransports);
    },
  );
  it('quarantines malformed or unsupported write settings without losing the registry', () => {
    const invalid: Record<string, string>[] = [
      { 'arc1.allow_writes': 'yes' },
      { 'arc1.allowed_packages': '' },
      { 'arc1.allowed_packages': '$TMP,' },
      { 'arc1.allowed_transports': 'A4H/**' },
      { 'arc1.allow_git_writes': 'false' },
    ];
    for (const props of invalid) {
      const r = registry(props);
      expect(r.available).toBe(true);
      expect(r.targets).toHaveLength(0);
      expect(r.diagnostics[0].status).toBe('quarantined');
    }
    expect(registry({}, { ...base, multiTargetAuthorization: 'standard' as never }).targets).toHaveLength(0);
    expect(registry({}, { ...base, multiTargetAllowBasicAuth: true }, 'BasicAuthentication').targets).toHaveLength(0);
  });
  it('bounds and normalizes explicit destination restrictions', () => {
    expect(parseDestinationAllowlist(' $tmp, ZTEAM/**, zteam/** ', 'packages')).toEqual(['$TMP', 'ZTEAM/**']);
    expect(parseDestinationAllowlist(undefined, 'transports')).toBeUndefined();
    for (const value of ['', ',', 'Z*,', 'ＺTEAM', 'Z'.repeat(129), Array(129).fill('Z').join(',')])
      expect(() => parseDestinationAllowlist(value, 'packages')).toThrow();
  });
  it('rejects malformed write grants without broadening the read grant', () => {
    for (const value of [['*'], ['A4H/001', '*'], ['A4H/001,A4H/100'], ['a4h/001', 'Ａ4H/100']])
      expect(parseTargetGrant(auth(value), 'arc1_write_targets').mode).toBe('none');
    expect(parseTargetGrant(auth(['*'])).mode).toBe('all');
  });
  it('checks each package policy, including an unrestricted global policy', async () => {
    const config = { ...defaultSafetyConfig(), ...runtime(), allowedPackages: [] };
    await expect(checkPackage(config, '$TMP')).resolves.toBeUndefined();
    await expect(checkPackage(config, 'ZOTHER')).rejects.toThrow();
    const resolver = {
      isDescendantOrSelf: async (root: string, pkg: string) => root === 'ZGLOBAL_TEAM' && pkg === 'ZGLOBAL_CHILD',
    };
    await expect(
      checkPackage({ ...config, allowedPackages: ['ZGLOBAL*'] }, 'ZGLOBAL_CHILD', resolver as never),
    ).resolves.toBeUndefined();
    await expect(
      checkPackage({ ...config, allowedPackages: ['$TMP'] }, 'ZGLOBAL_CHILD', resolver as never),
    ).rejects.toThrow();
    await expect(
      checkPackage(config, 'ZGLOBAL_CHILD', {
        isDescendantOrSelf: async () => {
          throw new Error('metadata denied');
        },
      } as never),
    ).rejects.toThrow();
  });
  it('changes the drift fingerprint when a write restriction changes', () => {
    expect(registry().targets[0].fingerprint).not.toBe(
      registry({ 'arc1.allowed_packages': '$TMP' }).targets[0].fingerprint,
    );
    expect(registry().targets[0].fingerprint).not.toBe(
      registry({ 'arc1.allowed_transports': 'A4HK9*' }).targets[0].fingerprint,
    );
  });
  it('advertises only the reviewed write fields and truthful annotations', () => {
    const config = runtime();
    const definitions = multiTargetToolDefinitions(getToolDefinitions(config), config);
    const write = definitions.find((t) => t.name === 'SAPWrite')!;
    expect(write).toBeDefined();
    expect(write.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    expect(write.inputSchema.properties).not.toHaveProperty('include');
    expect(write.inputSchema.properties).not.toHaveProperty('lintBeforeWrite');
    const aggregate = runtime(auth(), 'aggregate');
    expect(
      multiTargetToolDefinitions(getToolDefinitions(aggregate), aggregate).some((t) => t.name === 'SAPWrite'),
    ).toBe(false);
  });
  it.each([
    { action: 'delete' },
    { type: 'PROG' },
    { include: 'main' },
    { method: 'lcl_helper~run' },
    { target: 'A4H/001' },
    { lintBeforeWrite: false },
    { objects: [] },
  ])('rejects hidden write inputs before destination preparation: %j', async (extra) => {
    const r = registry();
    const identity = auth();
    const result = await prepareMultiTargetCall({
      options: {
        mode: 'pinned',
        registry: r,
        target: r.targets[0],
        instanceConfig: base,
        authorization: projectMultiTargetRequest(r, identity),
      },
      toolName: 'SAPWrite',
      rawArgs: { action: 'edit_method', type: 'CLAS', name: 'ZCL_TEST', source: 'body', ...extra },
      requestId: 'test',
      authInfo: identity,
    });
    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error('Hidden input reached preparation');
    expect(result.result.isError).toBe(true);
    expect(JSON.stringify(result.result)).toContain('MULTI_TARGET_OPERATION_FORBIDDEN');
  });
  it.each([
    [undefined, 'WRITE_TARGET_GRANT_MISSING'],
    [['*'], 'WRITE_TARGET_GRANT_MALFORMED'],
    [Array.from({ length: 257 }, (_, i) => `A4H/${String(i).padStart(3, '0')}`), 'WRITE_TARGET_GRANT_LIMIT_EXCEEDED'],
    [['A4H/100'], 'EXACT_WRITE_GRANT_REQUIRED'],
    [['A4H/001'], 'ENABLED_ON_PINNED_URL'],
  ])('explains the exact write grant in the aggregate catalog: %j', async (value, reason) => {
    const r = registry();
    const identity = auth(value);
    if (value === undefined) {
      delete (identity.extra!.xsuaaUserAttributes as Record<string, unknown>).arc1_write_targets;
      (identity.extra!.xsuaaUserAttributeStatus as Record<string, unknown>).arc1_write_targets = 'missing';
    }
    const result = await prepareMultiTargetCall({
      options: {
        mode: 'aggregate',
        registry: r,
        instanceConfig: base,
        authorization: projectMultiTargetRequest(r, identity),
      },
      toolName: 'SAPTargets',
      rawArgs: {},
      requestId: 'test',
      authInfo: identity,
    });
    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error('Catalog was not handled');
    expect(JSON.stringify(result.result)).toContain(reason);
  });
  it('normalizes omitted activation action before the global deny check', async () => {
    const r = registry();
    const identity = auth();
    const result = await prepareMultiTargetCall({
      options: {
        mode: 'pinned',
        registry: r,
        target: r.targets[0],
        instanceConfig: { ...base, denyActions: ['SAPActivate.activate'] },
        authorization: projectMultiTargetRequest(r, identity),
      },
      toolName: 'SAPActivate',
      rawArgs: { type: 'CLAS', name: 'ZCL_TEST' },
      requestId: 'test',
      authInfo: identity,
    });
    expect(result.handled).toBe(true);
  });
});
