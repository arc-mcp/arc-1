import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { pinnedPublicAuth } from '../../helpers/pinned-public-auth.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { pinnedMutationAllowed, pinnedUnsupportedRawFields } = await import(
  '../../../src/server/multi-target-write-surface.js'
);
const { getToolDefinitions } = await import('../../../src/handlers/tools.js');
const { multiTargetToolDefinitions, finalizeMultiTargetToolAnnotations } = await import(
  '../../../src/server/multi-target-tools.js'
);
const { filterToolsByAuthScope } = await import('../../../src/server/tool-auth.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { getActionPolicy } = await import('../../../src/authz/policy.js');

function selected(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...DEFAULT_CONFIG,
    client: '001',
    targetId: 'A4H/001',
    multiTargetEndpoints: true,
    multiTargetAuthorization: 'xsuaa-attribute',
    ppEnabled: true,
    ppStrict: true,
    allowWrites: true,
    allowTransportWrites: true,
    allowedPackages: ['$TMP'],
    lintBeforeWrite: false,
    multiTargetWrite: {
      enabled: true,
      target: 'A4H/001',
      allowedPackages: ['$TMP'],
      allowedTransports: ['*'],
      serverAllowedTransports: ['*'],
    },
    ...overrides,
  };
}
const write = {
  action: 'update',
  type: 'DDLS',
  name: 'ZEXAMPLE',
  source: '// changed',
  expectedSourceHash: 'a'.repeat(64),
};
function invoke(
  config = selected(),
  args: Record<string, unknown> = write,
  auth: AuthInfo | undefined = pinnedPublicAuth(),
  options: { tool?: string; client?: string; perUser?: boolean } = {},
) {
  const client = new AdtClient({ baseUrl: 'https://sap.invalid', client: options.client ?? '001', safety: config });
  return handleToolCall(
    client,
    config,
    options.tool ?? 'SAPWrite',
    args,
    auth,
    undefined,
    undefined,
    options.perUser ?? true,
  );
}
beforeEach(() => {
  mockFetch.mockReset();
  resetCachedFeatures();
  mockFetch.mockImplementation(() => {
    throw new Error('Unexpected mock HTTP dispatch');
  });
});

describe('public pinned admission before native I/O', () => {
  it.each([[], ['cloudDevelopment'], ['not-a-visibility'], false, 0].map((apiVisibility) => ({ apiVisibility })))(
    'refuses a raw API revoke visibility selection: %j',
    async ({ apiVisibility }) => {
      const result = await invoke(
        selected(),
        {
          action: 'set_api_state',
          type: 'CLAS',
          name: 'ZCL_EXAMPLE',
          contract: 'C1',
          apiState: 'NOT_RELEASED',
          expectedCurrentState: 'RELEASED',
          apiVisibility,
        },
        pinnedPublicAuth(),
        { tool: 'SAPManage' },
      );
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('MULTI_TARGET_OPERATION_FORBIDDEN');
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    { type: 'CLAS', processingType: 'rfc' },
    { type: 'CLAS/OC', updateTaskKind: 'startImmediate' },
    { type: 'CLAS', processingType: 'remote' },
    { type: 'CLAS', updateTaskKind: 'collectiveRun' },
    { type: 'FUNC', group: 'ZGROUP', updateTaskKind: 'startImmediate' },
    { type: 'FUGR/FF', group: 'ZGROUP', processingType: 'normal', updateTaskKind: 'startImmediate' },
    { type: 'func', group: 'ZGROUP', processingType: 'rfc', updateTaskKind: 'startImmediate' },
  ])('refuses raw function selectors in an incompatible batch item: %j', async (item) => {
    const result = await invoke(selected(), {
      action: 'batch_create',
      objects: [{ name: 'ZEXAMPLE', package: '$TMP', source: 'source', ...item }],
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('MULTI_TARGET_OPERATION_FORBIDDEN');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([undefined, 'normal', 'rfc'])(
    'refuses an update-task kind on a non-update FUNC create: %s',
    async (processingType) => {
      const result = await invoke(selected(), {
        action: 'create',
        type: 'FUGR/FF',
        name: 'ZFUNC',
        group: 'ZGROUP',
        package: '$TMP',
        source: 'source',
        processingType,
        updateTaskKind: 'startImmediate',
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('MULTI_TARGET_OPERATION_FORBIDDEN');
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it.each(['FUNC', 'func', 'FUGR/FF'])('preserves valid function selectors and aliases: %s', (type) => {
    for (const fields of [
      { processingType: 'normal' },
      { processingType: 'rfc' },
      { processingType: 'update', updateTaskKind: 'startImmediate' },
    ]) {
      const item = { type, name: 'ZFUNC', group: 'ZGROUP', package: '$TMP', source: 'source', ...fields };
      expect(pinnedUnsupportedRawFields('SAPWrite', 'create', { action: 'create', ...item })).toEqual([]);
      expect(
        pinnedUnsupportedRawFields('SAPWrite', 'batch_create', { action: 'batch_create', objects: [item] }),
      ).toEqual([]);
    }
  });

  it('preserves optional-field pollution handling and meaningful release visibility', () => {
    for (const apiVisibility of [undefined, null, '', ' '])
      expect(
        pinnedUnsupportedRawFields('SAPManage', 'set_api_state', {
          action: 'set_api_state',
          apiState: 'NOT_RELEASED',
          apiVisibility,
        }),
      ).toEqual([]);
    for (const apiVisibility of [[], ['cloudDevelopment']])
      expect(
        pinnedUnsupportedRawFields('SAPManage', 'set_api_state', {
          action: 'set_api_state',
          apiState: 'RELEASED',
          apiVisibility,
        }),
      ).toEqual([]);
    expect(
      pinnedUnsupportedRawFields('SAPWrite', 'batch_create', {
        action: 'batch_create',
        objects: [
          {
            type: 'CLAS',
            name: 'ZCLASS',
            package: '$TMP',
            source: 'source',
            processingType: null,
            updateTaskKind: ' ',
          },
        ],
      }),
    ).toEqual([]);
  });

  it.each([
    'raw-write',
    'write-grant',
    'read-grant',
    'invalid-status',
    'wildcard-write',
    'unverified',
    'basic',
    'readonly',
    'standard-auth',
    'copilot',
    'client',
    'per-user',
  ])('refuses %s without entering an adapter', async (kind) => {
    const auth = pinnedPublicAuth();
    const config = selected();
    if (kind === 'raw-write') {
      auth.scopes = ['read', 'admin'];
      auth.extra!.arc1VerifiedRawScopes = ['read', 'admin'];
    }
    if (kind === 'write-grant')
      (auth.extra!.xsuaaUserAttributes as Record<string, unknown>).arc1_write_targets = ['OTHER/001'];
    if (kind === 'read-grant')
      (auth.extra!.xsuaaUserAttributes as Record<string, unknown>).arc1_targets = ['OTHER/001'];
    if (kind === 'wildcard-write')
      (auth.extra!.xsuaaUserAttributes as Record<string, unknown>).arc1_write_targets = ['*'];
    if (kind === 'invalid-status')
      (auth.extra!.xsuaaUserAttributeStatus as Record<string, unknown>).arc1_write_targets = 'invalid';
    if (kind === 'unverified') delete auth.extra!.arc1VerifiedRawScopes;
    if (kind === 'basic') config.ppEnabled = false;
    if (kind === 'readonly') config.allowWrites = false;
    if (kind === 'standard-auth') config.multiTargetAuthorization = 'standard';
    if (kind === 'copilot') config.toolMode = 'hyperfocused';
    const result = await invoke(config, write, auth, {
      client: kind === 'client' ? '100' : '001',
      perUser: kind !== 'per-user',
    });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', 'not-a-hash', 'A'.repeat(64)])(
    'does not strip a malformed supplied metadata guard: %j',
    async (expectedMetadataHash) => {
      const result = await invoke(selected(), {
        action: 'update',
        type: 'SKTD',
        name: 'ZDOC',
        source: 'Text',
        expectedMetadataHash,
      });
      expect(result.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it('rejects a nested message field that the legacy Zod object would discard', async () => {
    const result = await invoke(selected(), {
      action: 'update',
      type: 'MSAG',
      name: 'ZMESSAGES',
      messages: [{ number: '001', shortText: 'Keep me', unsupportedNativeField: 'must not disappear' }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unsupported nested pinned input');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(['processingType', 'updateTaskKind', 'include', 'expectedMetadataHash'])(
    'refuses another adapter’s %s before normalization can discard it',
    async (field) => {
      const result = await invoke(selected(), {
        ...write,
        [field]: field === 'expectedMetadataHash' ? 'b'.repeat(64) : 'normal',
      });
      expect(result.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it.each(['flp_create_group', 'delete_package', 'publish_srvb'])(
    'does not turn a configured release override into native evidence: %s',
    async (action) => {
      const args =
        action === 'flp_create_group'
          ? { action, groupId: 'ZGROUP', title: 'Title' }
          : action === 'delete_package'
            ? { action, name: '$LOCAL' }
            : {
                action,
                name: 'ZBINDING',
                version: '0001',
                service_type: 'odatav4',
                expectedMetadataHash: 'a'.repeat(64),
              };
      const result = await invoke(selected({ systemType: 'onprem', abapRelease: '758' }), args, pinnedPublicAuth(), {
        tool: action === 'publish_srvb' ? 'SAPActivate' : 'SAPManage',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('native platform evidence');
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it.each(['server', 'destination'])(
    'requires both explicit unrestricted request policies for FLP/publication: %s',
    async (side) => {
      const config = selected();
      config.multiTargetWrite = {
        ...config.multiTargetWrite!,
        [side === 'server' ? 'serverAllowedTransports' : 'allowedTransports']: ['A4HK900001'],
      };
      expect(
        pinnedMutationAllowed('SAPManage', { action: 'flp_create_group', groupId: 'ZGROUP', title: 'Title' }, config),
      ).toBe(false);
      expect(
        pinnedMutationAllowed(
          'SAPActivate',
          {
            action: 'publish_srvb',
            name: 'ZBINDING',
            version: '0001',
            service_type: 'odatav4',
            expectedMetadataHash: 'a'.repeat(64),
          },
          config,
        ),
      ).toBe(false);
      const catalog = multiTargetToolDefinitions(getToolDefinitions(config), config);
      for (const tool of catalog) {
        const actions = (tool.inputSchema.properties as Record<string, { enum?: string[] }>).action?.enum ?? [];
        expect(actions).not.toContain('flp_create_group');
        expect(actions).not.toContain('publish_srvb');
      }
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it.each(['FUGR', 'ENHO', 'SKTD', 'DESD', 'TABL/DTT'])(
    'keeps an unsupported %s batch combination explicit',
    async (type) => {
      const result = await invoke(selected(), {
        action: 'batch_create',
        objects: [{ type, name: 'ZOWNER', source: 'source', package: '$TMP' }],
      });
      expect(result.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it('keeps companion actions read-scoped after functional writer actions are pruned', () => {
    const config = selected();
    const catalog = finalizeMultiTargetToolAnnotations(
      filterToolsByAuthScope(multiTargetToolDefinitions(getToolDefinitions(config), config), ['read'], []),
    );
    for (const [tool, action] of [
      ['SAPTransport', 'layers'],
      ['SAPTransport', 'targets'],
      ['SAPManage', 'features'],
      ['SAPManage', 'cache_stats'],
      ['SAPManage', 'flp_list_catalogs'],
    ]) {
      expect(getActionPolicy(tool, action)?.scope).toBe('read');
      const row = catalog.find((value) => value.name === tool)!;
      expect((row.inputSchema.properties as Record<string, { enum: string[] }>).action.enum).toContain(action);
      expect(row.annotations?.readOnlyHint).toBe(true);
    }
  });
});

it('rebuilds catalog descriptions after action denial without stale batch, RAP, trace or FLP promises', () => {
  const config = selected();
  const denied = [
    'SAPWrite.batch_create',
    'SAPWrite.scaffold_rap_handlers',
    'SAPWrite.generate_behavior_implementation',
    'SAPActivate.publish_srvb',
    'SAPActivate.unpublish_srvb',
    'SAPDiagnose.trace_start',
    'SAPDiagnose.trace_cancel',
    'SAPDiagnose.set_sql_trace_state',
    'SAPManage.flp_*',
  ];
  const catalog = finalizeMultiTargetToolAnnotations(
    filterToolsByAuthScope(
      multiTargetToolDefinitions(getToolDefinitions(config), config),
      ['read', 'write', 'transports'],
      denied,
    ),
  );
  for (const [tool, absent] of [
    ['SAPWrite', ['batch_create', 'scaffold_rap_handlers', 'generate_behavior_implementation']],
    ['SAPActivate', ['publish_srvb', 'unpublish_srvb']],
    ['SAPDiagnose', ['trace_start', 'trace_cancel', 'set_sql_trace_state']],
    ['SAPManage', ['flp_create_catalog', 'flp_list_catalogs']],
  ] as const) {
    const row = catalog.find((value) => value.name === tool)!;
    const actions = (row.inputSchema.properties as Record<string, { enum: string[] }>).action.enum;
    for (const action of absent) {
      expect(actions).not.toContain(action);
      expect(row.description).not.toContain(action);
    }
  }
  expect(catalog.find((value) => value.name === 'SAPDiagnose')!.description).toContain('syntax');
});

it('description compaction preserves named description inputs and nested constraints', () => {
  const config = selected();
  const tool = multiTargetToolDefinitions(getToolDefinitions(config), config).find(
    (value) => value.name === 'SAPWrite',
  )!;
  const fields = tool.inputSchema.properties as Record<string, any>;
  expect(fields.description.type).toBe('string');
  expect(fields.objects.items.properties.description.type).toBe('string');
  expect(fields.objects.items.properties.fixedValues.items.properties.description).toMatchObject({
    type: 'string',
    maxLength: 60,
  });
  expect(fields.objects.items.properties.parameters.items.properties.description).toMatchObject({
    type: 'string',
    minLength: 1,
    maxLength: 60,
  });
});

it('does not turn a configured platform override into source-qualified FLP evidence', async () => {
  const config = selected();
  setCachedFeatures({ abapRelease: '758', systemType: 'onprem', systemTypeSource: 'config' }, 'A4H/001');
  const client = new AdtClient({ baseUrl: 'https://sap.invalid', client: '001', safety: config });
  const result = await handleToolCall(
    client,
    config,
    'SAPManage',
    { action: 'flp_create_group', title: 'Synthetic', domainId: 'ZTEST' },
    pinnedPublicAuth(),
    undefined,
    undefined,
    true,
  );
  expect(result.isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
