import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { checkPackage, checkTransport, defaultSafetyConfig } from '../../../src/adt/safety.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { DestinationRegistry } from '../../../src/server/destination-registry.js';
import { parseTargetGrant } from '../../../src/server/multi-target-authorization.js';
import { parseDestinationAllowlist } from '../../../src/server/multi-target-destination-config.js';
import { projectMultiTargetRequest } from '../../../src/server/multi-target-request-projection.js';
import { buildMultiTargetConfig } from '../../../src/server/multi-target-runtime.js';
import { buildMultiTargetServerInstructions, prepareMultiTargetCall } from '../../../src/server/multi-target-server.js';
import {
  finalizeMultiTargetToolAnnotations,
  multiTargetToolDefinitions,
} from '../../../src/server/multi-target-tools.js';
import { PINNED_READ_COMPANIONS } from '../../../src/server/pinned-mutation-capabilities.js';
import { NATIVE_NAVIGATION_INSTRUCTIONS } from '../../../src/server/server-instructions.js';
import { filterToolsByAuthScope } from '../../../src/server/tool-auth.js';
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
  it.each(['', ' \r\n\t'])('routes blank include input to the handler refusal without SAP I/O: %j', async (source) => {
    const r = registry(),
      identity = auth();
    const prepared = await prepareMultiTargetCall({
      options: {
        mode: 'pinned',
        registry: r,
        target: r.targets[0],
        instanceConfig: base,
        authorization: projectMultiTargetRequest(r, identity),
      },
      toolName: 'SAPWrite',
      rawArgs: { action: 'update', type: 'CLAS', name: 'ZARC1_INCLUDE', include: 'definitions', source },
      requestId: 'include-blank',
      authInfo: identity,
    });
    expect(prepared.handled).toBe(false);
    if (prepared.handled) throw new Error('Blank input must reach the handler');
    const client = new AdtClient({
      baseUrl: 'http://sap.invalid',
      safety: { ...defaultSafetyConfig(), ...prepared.activeConfig },
    });
    const requests = (['get', 'post', 'put', 'delete'] as const).map((method) =>
      vi.spyOn(client.http, method).mockRejectedValue(new Error('Unexpected SAP I/O')),
    );
    const result = await handleToolCall(client, prepared.activeConfig, 'SAPWrite', prepared.args);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ error: 'PINNED_WRITE_REFUSED', state: 'unchanged' });
    for (const request of requests) expect(request).not.toHaveBeenCalled();
  });
  it.each([{ source: '', expectedSourceHash: 'a'.repeat(64) }, { source: '* New include\n' }])(
    'prepares a valid include update through the pinned route and catalog: %j',
    async (input) => {
      const r = registry();
      const identity = auth();
      const rawArgs = { action: 'update', type: 'CLAS', name: 'ZARC1_INCLUDE', include: 'definitions', ...input };
      const result = await prepareMultiTargetCall({
        options: {
          mode: 'pinned',
          registry: r,
          target: r.targets[0],
          instanceConfig: base,
          authorization: projectMultiTargetRequest(r, identity),
        },
        toolName: 'SAPWrite',
        rawArgs,
        requestId: 'include-valid',
        authInfo: identity,
      });
      expect(result.handled).toBe(false);
      if (result.handled) throw new Error('Valid include request was refused');
      expect(result.args).toMatchObject(rawArgs);
      const write = multiTargetToolDefinitions(getToolDefinitions(runtime()), runtime()).find(
        (t) => t.name === 'SAPWrite',
      )!;
      const validate = new Ajv2020({ strictTypes: false, allowUnionTypes: true }).compile(write.inputSchema);
      expect(validate(rawArgs), JSON.stringify(validate.errors)).toBe(true);
    },
  );
  it.each(['CLAS', 'INTF'])('prepares %s deletion without source or hash', async (type) => {
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
      rawArgs: { action: 'delete', type, name: 'ZARC1_DELETE' },
      requestId: 'delete-valid',
      authInfo: identity,
    });
    expect(result.handled).toBe(false);
    const write = multiTargetToolDefinitions(getToolDefinitions(runtime()), runtime()).find(
      (t) => t.name === 'SAPWrite',
    )!;
    expect((write.inputSchema.properties as Record<string, { enum: string[] }>).action.enum).toContain('delete');
    const validate = new Ajv2020({ strictTypes: false, allowUnionTypes: true }).compile(write.inputSchema);
    expect(validate({ action: 'delete', type, name: 'ZARC1_DELETE' }), JSON.stringify(validate.errors)).toBe(true);
    const denied = filterToolsByAuthScope([write], ['read', 'write'], ['SAPWrite.delete'])[0];
    expect((denied.inputSchema.properties as Record<string, { enum: string[] }>).action.enum).not.toContain('delete');
  });
  it.each([
    { action: 'delete', type: 'CLAS', include: 'testclasses' },
    { action: 'delete', type: 'CLAS', processingType: 'normal' },
    { action: 'delete', type: 'CLAS', updateTaskKind: 'immediate' },
    { action: 'create', type: 'CLAS', source: 'source', package: '$TMP', include: 'definitions' },
    { action: 'create', type: 'INTF', source: 'source', package: '$TMP', processingType: 'normal' },
    { action: 'update', type: 'INTF', source: 'source', expectedSourceHash: 'a'.repeat(64), include: 'main' },
  ])('rejects raw input before legacy normalization drops it: %j', async (rawArgs) => {
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
      rawArgs: { name: 'ZARC1_DELETE', ...rawArgs },
      requestId: 'raw-field-refusal',
      authInfo: identity,
    });
    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error('Meaningful raw field reached destination preparation');
    expect(JSON.stringify(result.result)).toContain('MULTI_TARGET_OPERATION_FORBIDDEN');
  });
  it.each(['reader', 'no-write-grant', 'destination-readonly', 'global-readonly', 'aggregate', 'basic'] as const)(
    'keeps deletion out of %s catalogs and direct calls',
    async (kind) => {
      const instance = { ...base, allowWrites: kind !== 'global-readonly', multiTargetAllowBasicAuth: true };
      const r = registry(
        kind === 'destination-readonly' || kind === 'basic' ? { 'arc1.allow_writes': 'false' } : {},
        instance,
        kind === 'basic' ? 'BasicAuthentication' : 'PrincipalPropagation',
      );
      const identity = kind === 'reader' ? auth(['A4H/001'], ['read']) : kind === 'no-write-grant' ? auth([]) : auth();
      const options = {
        mode: kind === 'aggregate' ? ('aggregate' as const) : ('pinned' as const),
        registry: r,
        target: r.targets[0],
        instanceConfig: instance,
        authorization: projectMultiTargetRequest(r, identity),
      };
      const config = buildMultiTargetConfig(instance, r.targets[0], options);
      expect(multiTargetToolDefinitions(getToolDefinitions(config), config).some((t) => t.name === 'SAPWrite')).toBe(
        false,
      );
      const result = await prepareMultiTargetCall({
        options,
        toolName: 'SAPWrite',
        rawArgs: {
          action: 'delete',
          type: 'CLAS',
          name: 'ZARC1_DELETE',
          ...(kind === 'aggregate' ? { target: 'A4H/001' } : {}),
        },
        requestId: 'delete-denied',
        authInfo: identity,
      });
      expect(result.handled).toBe(true);
      if (!result.handled) throw new Error('Deletion escaped route refusal');
      expect(JSON.stringify(result.result)).toContain('MULTI_TARGET_OPERATION_FORBIDDEN');
    },
  );
  it('adds only the explicit formatter companions and setting action to a writable pinned catalog', () => {
    expect(PINNED_READ_COMPANIONS.map(({ tool, action, fields }) => ({ tool, action, fields }))).toEqual([
      { tool: 'SAPLint', action: 'get_formatter_settings', fields: ['action'] },
      { tool: 'SAPLint', action: 'format', fields: ['action', 'source'] },
    ]);
    const config = runtime();
    const catalog = multiTargetToolDefinitions(getToolDefinitions(config), config);
    const lint = catalog.find((tool) => tool.name === 'SAPLint')!;
    expect((lint.inputSchema.properties as Record<string, { enum: string[] }>).action.enum).toEqual([
      'lint',
      'lint_and_fix',
      'list_rules',
      'format',
      'get_formatter_settings',
      'set_formatter_settings',
    ]);
    expect(lint.inputSchema.properties).toHaveProperty('indentation');
    expect(lint.inputSchema.properties).toHaveProperty('style');
    expect(lint.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const denied = finalizeMultiTargetToolAnnotations(
      filterToolsByAuthScope(catalog, ['read', 'write'], ['SAPLint.set_formatter_settings']),
    );
    const readLint = denied.find((tool) => tool.name === 'SAPLint')!;
    expect((readLint.inputSchema.properties as Record<string, { enum: string[] }>).action.enum).not.toContain(
      'set_formatter_settings',
    );
    expect(readLint.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it.each(['reader', 'destination-readonly', 'aggregate', 'basic', 'global-readonly'] as const)(
    'keeps formatter calls and companions out of the %s route',
    async (kind) => {
      const instance = { ...base, allowWrites: kind !== 'global-readonly', multiTargetAllowBasicAuth: true };
      const r = registry(
        kind === 'destination-readonly' || kind === 'basic' ? { 'arc1.allow_writes': 'false' } : {},
        instance,
        kind === 'basic' ? 'BasicAuthentication' : 'PrincipalPropagation',
      );
      const identity = kind === 'reader' ? auth([], ['read']) : auth();
      const options = {
        mode: kind === 'aggregate' ? ('aggregate' as const) : ('pinned' as const),
        registry: r,
        target: r.targets[0],
        instanceConfig: instance,
        authorization: projectMultiTargetRequest(r, identity),
      };
      const config = buildMultiTargetConfig(instance, r.targets[0], options);
      const lint = multiTargetToolDefinitions(getToolDefinitions(config), config).find(
        (tool) => tool.name === 'SAPLint',
      )!;
      expect((lint.inputSchema.properties as Record<string, { enum: string[] }>).action.enum).toEqual([
        'lint',
        'lint_and_fix',
        'list_rules',
      ]);
      expect(lint.inputSchema.properties).not.toHaveProperty('indentation');
      expect(lint.inputSchema.properties).not.toHaveProperty('style');
      for (const args of [
        { action: 'format', source: 'REPORT ztest.' },
        { action: 'get_formatter_settings' },
        { action: 'set_formatter_settings', indentation: false },
      ]) {
        const result = await prepareMultiTargetCall({
          options,
          toolName: 'SAPLint',
          rawArgs: { ...args, ...(kind === 'aggregate' ? { target: 'A4H/001' } : {}) },
          requestId: 'formatter-denied',
          authInfo: identity,
        });
        expect(result.handled).toBe(true);
        if (!result.handled) throw new Error('Formatter reached preparation on a read-only route');
        expect(JSON.stringify(result.result)).toContain('MULTI_TARGET_OPERATION_FORBIDDEN');
      }
    },
  );

  it.each([
    { action: 'set_formatter_settings' },
    { action: 'set_formatter_settings', style: 'unknown' },
    { action: 'set_formatter_settings', indentation: 'maybe' },
    { action: 'set_formatter_settings', indentation: false, user: 'OTHER' },
    { action: 'get_formatter_settings', user: 'OTHER' },
    { action: 'format', source: {} },
    { action: 'format' },
    { action: 'format', source: 'REPORT ztest.', target: 'OTHER/001' },
  ])('rejects invalid/hidden formatter inputs before PP preparation: %j', async (rawArgs) => {
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
      toolName: 'SAPLint',
      rawArgs,
      requestId: 'formatter-invalid',
      authInfo: identity,
    });
    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error('Invalid formatter arguments reached preparation');
    expect(JSON.stringify(result.result)).toContain('MULTI_TARGET_OPERATION_FORBIDDEN');
  });

  it.each([
    { action: 'set_formatter_settings', indentation: false },
    { action: 'set_formatter_settings', indentation: 'false' },
    { action: 'set_formatter_settings', indentation: 0 },
    { action: 'set_formatter_settings', style: 'none' },
    { action: 'get_formatter_settings' },
    { action: 'format', source: 'REPORT ztest.' },
  ])('prepares supported formatter inputs without weakening their route policy: %j', async (rawArgs) => {
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
      toolName: 'SAPLint',
      rawArgs,
      requestId: 'formatter-valid',
      authInfo: identity,
    });
    expect(result.handled).toBe(false);
    if (result.handled) throw new Error('Valid formatter arguments were refused');
    expect(result.activeConfig.multiTargetWrite?.enabled).toBe(true);
    expect(result.selectedTarget.target).toBe('A4H/001');
  });

  it.each(['writer', 'reader', 'aggregate'] as const)(
    'retains native navigation and accurate mutation guidance for %s connections',
    (kind) => {
      const r = registry();
      const identity = kind === 'reader' ? auth([], ['read']) : auth();
      const instructions = buildMultiTargetServerInstructions({
        mode: kind === 'aggregate' ? 'aggregate' : 'pinned',
        registry: r,
        target: kind === 'aggregate' ? undefined : r.targets[0],
        instanceConfig: base,
        authorization: projectMultiTargetRequest(r, identity),
      });
      expect(instructions).toContain(NATIVE_NAVIGATION_INSTRUCTIONS);
      expect(instructions.length).toBeLessThan(2048);
      if (kind === 'writer') {
        expect(instructions).toContain('scoped read/write');
        expect(instructions).toContain(
          'CLAS/INTF main-source writes, CLAS local-include replacements and owner deletion require both package policies',
        );
        expect(instructions).toContain('Activation affects the whole owner');
        expect(instructions).not.toContain('Writes, activation, transport/Git mutations');
      } else {
        expect(instructions).toContain('read-only interface');
        expect(instructions).toContain('Writes, activation, transport/Git mutations');
        expect(instructions).not.toContain('scoped read/write');
      }
    },
  );

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
    expect(write.inputSchema.properties).toHaveProperty('include.enum', [
      'definitions',
      'implementations',
      'macros',
      'testclasses',
    ]);
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
