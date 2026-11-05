import { readFileSync } from 'node:fs';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { describe, expect, it } from 'vitest';
import { ACTION_POLICY } from '../../../src/authz/policy.js';
import { getToolSchema } from '../../../src/handlers/schemas.js';
import { getToolDefinitions, type ToolDefinition } from '../../../src/handlers/tools.js';
import { DestinationRegistry } from '../../../src/server/destination-registry.js';
import { projectMultiTargetRequest } from '../../../src/server/multi-target-request-projection.js';
import { prepareMultiTargetCall } from '../../../src/server/multi-target-server.js';
import { multiTargetInvocationDecision, multiTargetToolDefinitions } from '../../../src/server/multi-target-tools.js';
import {
  pinnedCompanionAllowed,
  pinnedMutationAllowed,
  pinnedRuntimeCandidateAllowed,
} from '../../../src/server/multi-target-write-surface.js';
import {
  PINNED_MUTATION_CAPABILITIES,
  PINNED_READ_COMPANIONS,
} from '../../../src/server/pinned-mutation-capabilities.js';
import {
  PINNED_RUNTIME_CANDIDATES,
  PINNED_RUNTIME_COMPANION_CANDIDATES,
  PINNED_RUNTIME_MISSING_QUALIFICATION,
} from '../../../src/server/pinned-runtime-candidates.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

const writer: ServerConfig = {
  ...DEFAULT_CONFIG,
  allowWrites: true,
  ppEnabled: true,
  ppStrict: true,
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: ['*'],
    serverAllowedTransports: ['*'],
  },
};

const VALID: Record<string, Record<string, unknown>> = {
  apply_quickfix: {
    action: 'apply_quickfix',
    type: 'CLAS',
    name: 'ZCL_TEST',
    source: 'REPORT test.',
    line: 1,
    proposalUri: '/sap/bc/adt/quickfixes/proposals/providers/refactoring/quickfixes/declare_local_variable',
    proposalUserContent: '',
  },
  trace_start: { action: 'trace_start', traceUser: 'MARIAN', maxExecutions: 1, expiresHours: 1, processType: 'http' },
  trace_cancel: {
    action: 'trace_cancel',
    traceUser: 'MARIAN',
    id: '/sap/bc/adt/runtime/traces/abaptraces/requests/h%2c1%2c2',
  },
  set_sql_trace_state: { action: 'set_sql_trace_state', sqlOn: true, user: 'MARIAN' },
  flp_create_catalog: { action: 'flp_create_catalog', domainId: 'ZARC1_CAT', title: 'Catalog' },
  flp_create_group: { action: 'flp_create_group', groupId: 'ZARC1_GROUP', title: 'Group' },
  flp_create_tile: {
    action: 'flp_create_tile',
    catalogId: 'ZARC1_CAT',
    tile: { id: 'T', title: 'T', semanticObject: 'Sales', semanticAction: 'display' },
  },
  flp_add_tile_to_group: {
    action: 'flp_add_tile_to_group',
    groupId: 'ZARC1_GROUP',
    catalogId: 'ZARC1_CAT',
    tileInstanceId: 'I',
  },
  flp_delete_catalog: { action: 'flp_delete_catalog', catalogId: 'ZARC1_CAT' },
  flp_list_catalogs: { action: 'flp_list_catalogs' },
  flp_list_groups: { action: 'flp_list_groups' },
  flp_list_tiles: { action: 'flp_list_tiles', catalogId: 'ZARC1_CAT' },
};
const candidates = [...PINNED_RUNTIME_CANDIDATES, ...PINNED_RUNTIME_COMPANION_CANDIDATES];
const keys = candidates.map((row) => `${row.tool}.${row.action}`);

describe('runtime and quickfix candidate rows', () => {
  it('cover exactly the private runtime and quickfix actions with explicit resources', () => {
    expect(keys.sort()).toEqual(
      [
        'SAPDiagnose.apply_quickfix',
        'SAPDiagnose.trace_start',
        'SAPDiagnose.trace_cancel',
        'SAPDiagnose.set_sql_trace_state',
        'SAPManage.flp_create_catalog',
        'SAPManage.flp_create_group',
        'SAPManage.flp_create_tile',
        'SAPManage.flp_add_tile_to_group',
        'SAPManage.flp_delete_catalog',
        'SAPManage.flp_list_catalogs',
        'SAPManage.flp_list_groups',
        'SAPManage.flp_list_tiles',
      ].sort(),
    );
    for (const row of PINNED_RUNTIME_CANDIDATES) {
      expect(row.resource).toBe(
        row.action === 'apply_quickfix' ? 'quickfix-proposal' : row.tool === 'SAPDiagnose' ? 'trace' : 'flp',
      );
      expect(row.types).toBeUndefined();
    }
  });

  it('are explicitly admitted under the selected writer contract', () => {
    const admitted = new Set(
      [...PINNED_MUTATION_CAPABILITIES, ...PINNED_READ_COMPANIONS].map((row) => `${row.tool}.${row.action}`),
    );
    for (const row of candidates) {
      const key = `${row.tool}.${row.action}`;
      expect(admitted.has(key), key).toBe(true);
      const args = VALID[row.action];
      expect(pinnedMutationAllowed(row.tool, args, writer) || pinnedCompanionAllowed(row.tool, args, writer), key).toBe(
        true,
      );
      expect(multiTargetInvocationDecision(row.tool, args, writer), key).toBe('allowed');
    }
  });

  it('keep these actions out of reader, Basic and read-only catalogs', () => {
    for (const config of [
      { ...writer, multiTargetWrite: undefined },
      { ...writer, ppEnabled: false, ppStrict: false, multiTargetWrite: undefined },
      { ...writer, allowWrites: false },
    ]) {
      const tools = multiTargetToolDefinitions(getToolDefinitions(config), config);
      expect(tools.some((tool) => tool.name === 'SAPManage')).toBe(false);
      const diagnose = tools.find((tool) => tool.name === 'SAPDiagnose') as ToolDefinition;
      const actions = (diagnose.inputSchema.properties as Record<string, { enum: string[] }>).action.enum;
      expect(actions).not.toContain('trace_start');
      expect(actions).not.toContain('trace_cancel');
      expect(actions).not.toContain('set_sql_trace_state');
      expect(diagnose.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it('state the missing PP-route trace-user requirement on PP readers without changing the Basic default', () => {
    const description = (config: ServerConfig) => {
      const tools = multiTargetToolDefinitions(getToolDefinitions(config), config);
      const diagnose = tools.find((tool) => tool.name === 'SAPDiagnose') as ToolDefinition;
      return (diagnose.inputSchema.properties as Record<string, { description: string }>).traceUser.description;
    };
    expect(description(writer)).toContain('for trace_requests on Principal Propagation targets');
    expect(description({ ...writer, ppEnabled: false, ppStrict: false, multiTargetWrite: undefined })).toContain(
      'default connected user',
    );
  });

  it('declare only inputs the runtime schema knows and remain in sync with the existing policy classification', () => {
    for (const row of candidates) {
      const schema = getToolSchema(row.tool, false) as unknown as { shape: Record<string, unknown> };
      for (const field of row.fields) expect(Object.keys(schema.shape), `${row.action}.${field}`).toContain(field);
      const policy = ACTION_POLICY[`${row.tool}.${row.action}`];
      expect(policy).toBeDefined();
      if (row.action.startsWith('flp_list_')) expect(policy.scope).toBe('read');
      else expect(policy.scope).toBe('write');
    }
  });

  it('accept the reviewed input through the qualification decision', () => {
    for (const row of candidates)
      expect(pinnedRuntimeCandidateAllowed(row.tool, VALID[row.action], writer), row.action).toBe(true);
  });

  it.each([
    ['no global writes', { allowWrites: false }],
    ['non-strict PP', { ppStrict: false }],
    ['PP off', { ppEnabled: false }],
    ['destination writes off', { multiTargetWrite: undefined }],
    ['disabled destination policy', { multiTargetWrite: { ...writer.multiTargetWrite!, enabled: false } }],
  ] as const)('fail the qualification decision with %s', (_label, overrides) => {
    const config = { ...writer, ...overrides } as ServerConfig;
    for (const row of candidates)
      expect(pinnedRuntimeCandidateAllowed(row.tool, VALID[row.action], config), row.action).toBe(false);
  });

  it('apply action denial, the FLP feature switch and the raw-field contract', () => {
    for (const row of candidates) {
      const args = VALID[row.action];
      expect(
        pinnedRuntimeCandidateAllowed(row.tool, args, { ...writer, denyActions: [`${row.tool}.${row.action}`] }),
      ).toBe(false);
      expect(pinnedRuntimeCandidateAllowed(row.tool, args, { ...writer, denyActions: [`${row.tool}.*`] })).toBe(false);
      for (const extra of ['package', 'transport', 'target', 'unexpected']) {
        if (row.fields.includes(extra)) continue;
        expect(
          pinnedRuntimeCandidateAllowed(row.tool, { ...args, [extra]: 'value' }, writer),
          `${row.action}.${extra}`,
        ).toBe(false);
      }
      if (row.tool === 'SAPManage')
        expect(pinnedRuntimeCandidateAllowed(row.tool, args, { ...writer, featureFlp: 'off' })).toBe(false);
    }
    expect(pinnedRuntimeCandidateAllowed('SAPGit', { action: 'pull' }, writer)).toBe(false);
    expect(pinnedRuntimeCandidateAllowed('SAPDiagnose', { action: 'apply_quickfix' }, writer)).toBe(false);
  });

  it('name missing qualification for every row, in the research recipe', () => {
    const recipe = readFileSync(
      new URL('../../../docs/research/broader-pinned-pp-writes/native-runtime-contracts.md', import.meta.url),
      'utf8',
    );
    expect(Object.keys(PINNED_RUNTIME_MISSING_QUALIFICATION).sort()).toEqual([...keys].sort());
    for (const scenarios of Object.values(PINNED_RUNTIME_MISSING_QUALIFICATION)) {
      expect(scenarios.length).toBeGreaterThan(0);
      for (const scenario of scenarios) expect(recipe).toContain(`| ${scenario} |`);
    }
  });
});

describe('hidden calls on real route preparation', () => {
  const base = {
    ...DEFAULT_CONFIG,
    multiTargetEndpoints: true,
    multiTargetAuthorization: 'xsuaa-attribute' as const,
    allowWrites: true,
    allowedPackages: ['$TMP'],
    allowedTransports: ['*'],
  };
  function registry(authentication = 'PrincipalPropagation', properties: Record<string, string> = {}) {
    return DestinationRegistry.fromDiscovery(
      {
        subaccount: [
          {
            name: 'TEST',
            type: 'HTTP',
            urlState: 'valid',
            urlFingerprint: 'test',
            authentication,
            proxyType: 'OnPremise',
            sapSysId: 'A4H',
            sapClient: '001',
            description: 'Test',
            hasCloudConnectorLocationId: false,
            arcProperties: {
              'arc1.enabled': 'true',
              'arc1.allow_writes': 'true',
              'arc1.allowed_packages': '$TMP',
              ...properties,
            },
          },
        ],
        instanceNames: [],
        scannedCount: 1,
        unrelatedCount: 0,
        arcAdjacentWithoutMarkerCount: 0,
      },
      base,
    );
  }
  const identity = (write: string[] = ['A4H/001']): AuthInfo => ({
    token: 'verified-test',
    clientId: 'test',
    scopes: ['read', 'write', 'admin'],
    extra: {
      arc1VerifiedRawScopes: ['read', 'write'],
      xsuaaUserAttributes: { arc1_targets: ['*'], arc1_write_targets: write },
      xsuaaUserAttributeStatus: { arc1_targets: 'valid', arc1_write_targets: 'valid' },
    },
  });

  it.each(candidates.map((row) => [row.tool, row.action] as const))(
    'prepares explicitly admitted %s %s for a fully granted pinned writer',
    async (toolName, action) => {
      const r = registry('PrincipalPropagation', { 'arc1.allowed_transports': '*' });
      const auth = identity();
      const prepared = await prepareMultiTargetCall({
        options: {
          mode: 'pinned',
          registry: r,
          target: r.targets[0],
          instanceConfig: base,
          authorization: projectMultiTargetRequest(r, auth),
        },
        toolName,
        rawArgs: VALID[action],
        requestId: 'closed',
        authInfo: auth,
      });
      expect(prepared.handled).toBe(false);
    },
  );

  it.each(candidates.map((row) => [row.tool, row.action] as const))(
    'forbids %s %s through the aggregate route',
    async (toolName, action) => {
      const r = registry();
      const auth = identity();
      const prepared = await prepareMultiTargetCall({
        options: {
          mode: 'aggregate',
          registry: r,
          instanceConfig: base,
          authorization: projectMultiTargetRequest(r, auth),
        },
        toolName,
        rawArgs: { ...VALID[action], target: 'A4H/001' },
        requestId: 'closed-aggregate',
        authInfo: auth,
      });
      expect(prepared.handled).toBe(true);
      if (!prepared.handled) throw new Error('Expected refusal');
      expect(JSON.stringify(prepared.result)).toContain('MULTI_TARGET_OPERATION_FORBIDDEN');
    },
  );
});
