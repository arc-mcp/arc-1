import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getToolDefinitions, type ToolDefinition } from '../../../src/handlers/tools.js';
import type { ServerConfig } from '../../../src/server/types.js';

// Isolate a trace/FLP-only registration to test partial-admission projection independently of
// other real adapters. The real matrix and public-handler tests cover the integrated surface.
vi.mock('../../../src/server/pinned-mutation-capabilities.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/server/pinned-mutation-capabilities.js')>();
  const { PINNED_RUNTIME_CANDIDATES: candidates, PINNED_RUNTIME_COMPANION_CANDIDATES } = await import(
    '../../../src/server/pinned-runtime-candidates.js'
  );
  // This synthetic subset deliberately excludes quickfix.
  const PINNED_RUNTIME_CANDIDATES = candidates.filter((row) => row.action !== 'apply_quickfix');
  return {
    ...actual,
    pinnedMutationCapability: (tool: string, action: unknown) =>
      PINNED_RUNTIME_CANDIDATES.find((row) => row.tool === tool && row.action === action) ??
      (['SAPWrite', 'SAPActivate', 'SAPLint'].includes(tool)
        ? actual.pinnedMutationCapability(tool, action)
        : undefined),
    pinnedCompanionCapability: (tool: string, action: unknown) =>
      PINNED_RUNTIME_COMPANION_CANDIDATES.find((row) => row.tool === tool && row.action === action) ??
      (tool === 'SAPLint' ? actual.pinnedCompanionCapability(tool, action) : undefined),
    pinnedMutationToolSurface: (tool: string, enabled: (row: never) => boolean) => {
      const rows = PINNED_RUNTIME_CANDIDATES.filter((row) => row.tool === tool && enabled(row as never));
      if (!rows.length)
        return ['SAPWrite', 'SAPActivate', 'SAPLint'].includes(tool)
          ? actual.pinnedMutationToolSurface(tool, enabled as never)
          : undefined;
      return { actions: rows.map((row) => row.action), types: [], fields: new Set(rows.flatMap((row) => row.fields)) };
    },
    pinnedCompanionToolSurface: (tool: string, enabled: (row: never) => boolean) => {
      const rows = PINNED_RUNTIME_COMPANION_CANDIDATES.filter((row) => row.tool === tool && enabled(row as never));
      if (!rows.length)
        return tool === 'SAPLint' ? actual.pinnedCompanionToolSurface(tool, enabled as never) : undefined;
      return { actions: rows.map((row) => row.action), fields: new Set(rows.flatMap((row) => row.fields)) };
    },
  };
});

const { finalizeMultiTargetToolAnnotations, multiTargetInvocationDecision, multiTargetToolDefinitions } = await import(
  '../../../src/server/multi-target-tools.js'
);
const { filterToolsByAuthScope } = await import('../../../src/server/tool-auth.js');
const { handlePinnedFlp } = await import('../../../src/handlers/pinned-flp.js');
const { handlePinnedTrace } = await import('../../../src/handlers/pinned-trace.js');
const { DEFAULT_CONFIG } = await import('../../../src/server/types.js');
const { AdtClient } = await import('../../../src/adt/client.js');
const { unrestrictedSafetyConfig } = await import('../../../src/adt/safety.js');

const policy = {
  enabled: true,
  target: 'A4H/001',
  allowedPackages: ['$TMP'],
  allowedTransports: ['*'],
  serverAllowedTransports: ['*'],
};
const writer: ServerConfig = {
  ...DEFAULT_CONFIG,
  targetId: 'A4H/001',
  allowWrites: true,
  ppEnabled: true,
  ppStrict: true,
  multiTargetWrite: policy,
};

function catalog(config = writer, scopes = ['read', 'write'], denied: string[] = []) {
  return finalizeMultiTargetToolAnnotations(
    filterToolsByAuthScope(multiTargetToolDefinitions(getToolDefinitions(config), config), scopes, denied),
  );
}
const tool = (tools: ToolDefinition[], name: string) => tools.find((entry) => entry.name === name) as ToolDefinition;
const actions = (entry: ToolDefinition) =>
  (entry.inputSchema.properties as Record<string, { enum: string[] }>).action.enum;
const prop = (entry: ToolDefinition, name: string) =>
  (entry.inputSchema.properties as Record<string, Record<string, unknown>>)[name];

describe('admitted-candidate projection (synthetic registration)', () => {
  it('projects only the trace controls, with pinned bounds and truthful annotations', () => {
    const diagnose = tool(catalog(), 'SAPDiagnose');
    expect(actions(diagnose)).toEqual(
      expect.arrayContaining(['trace_start', 'trace_cancel', 'set_sql_trace_state', 'traces']),
    );
    expect(actions(diagnose)).not.toContain('apply_quickfix');
    expect(actions(diagnose)).not.toContain('atc_ci');
    expect(diagnose.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    expect(prop(diagnose, 'maxExecutions')).toMatchObject({ type: 'integer', minimum: 1, maximum: 100 });
    expect(prop(diagnose, 'expiresHours')).toMatchObject({ exclusiveMinimum: 0, maximum: 24 });
    expect(prop(diagnose, 'traceUser').description).toContain('Exact SAP user');
    expect(prop(diagnose, 'sqlOn').description).toContain('every application-server instance');
    expect(diagnose.description).toContain('not client-isolated');
    expect(diagnose.inputSchema.properties).not.toHaveProperty('allUsers');
  });

  it('projects a dedicated FLP tool without package, API-state or arbitrary fields', () => {
    const manage = tool(catalog(), 'SAPManage');
    expect(actions(manage)).toEqual([
      'flp_list_catalogs',
      'flp_list_groups',
      'flp_list_tiles',
      'flp_create_catalog',
      'flp_create_group',
      'flp_create_tile',
      'flp_add_tile_to_group',
      'flp_delete_catalog',
    ]);
    expect(Object.keys(manage.inputSchema.properties as object).sort()).toEqual(
      ['action', 'catalogId', 'domainId', 'groupId', 'tile', 'tileInstanceId', 'title'].sort(),
    );
    expect(manage.description).toContain('shared with this client’s users');
    expect(manage.description).toContain('native-governed/unverified');
    expect(manage.description).not.toContain('create_package');
    expect(manage.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it('leaves readers with listings only and recomputes annotations after scope and denial pruning', () => {
    const reader = tool(catalog(writer, ['read']), 'SAPManage');
    expect(actions(reader)).toEqual(['flp_list_catalogs', 'flp_list_groups', 'flp_list_tiles']);
    expect(reader.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(reader.description).not.toMatch(/flp_(create|add|delete)_/);
    const denied = catalog(
      writer,
      ['read', 'write'],
      ['SAPManage.flp_create_*', 'SAPManage.flp_add_*', 'SAPManage.flp_delete_*'],
    );
    expect(actions(tool(denied, 'SAPManage'))).toEqual(['flp_list_catalogs', 'flp_list_groups', 'flp_list_tiles']);
    expect(tool(denied, 'SAPManage').annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tool(denied, 'SAPManage').description).not.toMatch(/flp_(create|add|delete)_/);
  });

  it.each(['allowWrites', 'ppStrict', 'ppEnabled', 'multiTargetWrite'] as const)(
    'removes every action without %s',
    (gate) => {
      const config = { ...writer, [gate]: gate === 'multiTargetWrite' ? undefined : false } as ServerConfig;
      const tools = catalog(config);
      expect(tools.some((entry) => entry.name === 'SAPManage')).toBe(false);
      const diagnose = tool(tools, 'SAPDiagnose');
      if (diagnose) expect(actions(diagnose)).not.toContain('trace_start');
      expect(multiTargetInvocationDecision('SAPManage', { action: 'flp_list_catalogs' }, config)).toBe('forbidden');
    },
  );

  it('removes FLP with its feature switch and keeps trace controls', () => {
    const config = { ...writer, featureFlp: 'off' as const };
    expect(catalog(config).some((entry) => entry.name === 'SAPManage')).toBe(false);
    expect(actions(tool(catalog(config), 'SAPDiagnose'))).toContain('trace_start');
  });

  it('applies the final input contract at invocation', () => {
    const decide = (name: string, args: Record<string, unknown>) => multiTargetInvocationDecision(name, args, writer);
    expect(decide('SAPDiagnose', { action: 'trace_start', traceUser: 'MARIAN', maxExecutions: '5' })).toBe('allowed');
    expect(decide('SAPDiagnose', { action: 'trace_start', traceUser: 'MARIAN', sqlTrace: 'false' })).toBe('allowed');
    expect(decide('SAPDiagnose', { action: 'trace_start' })).toBe('forbidden');
    expect(decide('SAPDiagnose', { action: 'trace_start', traceUser: 'A*' })).toBe('forbidden');
    expect(decide('SAPDiagnose', { action: 'trace_start', traceUser: 'MARIAN', maxExecutions: 101 })).toBe('forbidden');
    expect(decide('SAPDiagnose', { action: 'set_sql_trace_state', sqlOn: 'true', user: 'MARIAN' })).toBe('allowed');
    expect(decide('SAPDiagnose', { action: 'set_sql_trace_state', sqlOn: true })).toBe('forbidden');
    expect(decide('SAPDiagnose', { action: 'set_sql_trace_state', sqlOn: true, allUsers: true })).toBe('forbidden');
    expect(decide('SAPManage', { action: 'flp_delete_catalog', catalogId: "Z')" })).toBe('forbidden');
    expect(
      decide('SAPManage', { action: 'flp_create_catalog', domainId: 'Z', title: 'T', transport: 'A4HK900001' }),
    ).toBe('forbidden');
    const tile = { id: 'T', title: 'T', semanticObject: 'Sales', semanticAction: 'display' };
    expect(decide('SAPManage', { action: 'flp_create_tile', catalogId: 'Z', tile })).toBe('allowed');
    expect(
      decide('SAPManage', { action: 'flp_create_tile', catalogId: 'Z', tile: { ...tile, scope: 'CONFIGURATION' } }),
    ).toBe('forbidden');
    expect(decide('SAPManage', { action: 'flp_list_tiles', catalogId: 'Z' })).toBe('allowed');
    expect(decide('SAPManage', { action: 'create_package', name: 'Z' })).toBe('forbidden');
  });
});

describe('handlers after a future admission (synthetic registration)', () => {
  let client: InstanceType<typeof AdtClient>;
  beforeEach(() => {
    client = new AdtClient({
      baseUrl: 'https://sap.example',
      client: '001',
      safety: { ...unrestrictedSafetyConfig(), multiTargetWrite: policy },
    });
  });

  it('keeps FLP mutations refused by their own recording lock, with no SAP I/O', async () => {
    const http = (['get', 'post', 'put', 'delete'] as const).map((method) =>
      vi.spyOn(client.http, method).mockRejectedValue(new Error('Unexpected SAP I/O')),
    );
    const result = await handlePinnedFlp(client, { action: 'flp_delete_catalog', catalogId: 'ZARC1_CAT' }, writer);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: 'PINNED_WRITE_REFUSED',
      state: 'unchanged',
      recording: 'not-established',
      message: expect.stringContaining('customizing recording'),
    });
    for (const spy of http) expect(spy).not.toHaveBeenCalled();
  });

  it('routes admitted listings through the scoped transport', async () => {
    const get = vi.spyOn(client.http, 'get').mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: JSON.stringify({ d: { results: [{ domainId: 'ZA', chipCount: '0001' }] } }),
    });
    const result = await handlePinnedFlp(client, { action: 'flp_list_catalogs' }, writer);
    expect(result.content[0].text).toContain('1 catalogs');
    expect(get.mock.calls[0][2]).toMatchObject({ noReplay: true, retryTransientErrors: false });
    expect(get.mock.calls[0][2]?.responseBudget?.limitBytes).toBe(8 * 1024 * 1024);
    expect(get.mock.calls[0][2]?.deadline).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it.each(['flp_list_catalogs', 'flp_list_groups', 'flp_list_tiles'])('marks capped %s incomplete', async (action) => {
    vi.spyOn(client.http, 'get').mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: JSON.stringify({
        d: {
          results: Array.from({ length: 500 }, (_, index) => ({
            pageId: 'X-SAP-UI2-CATALOGPAGE:ZCAT',
            instanceId: `I${index}`,
            chipId: 'C',
          })),
        },
      }),
    });
    const result = await handlePinnedFlp(
      client,
      { action, ...(action === 'flp_list_tiles' ? { catalogId: 'ZCAT' } : {}) },
      writer,
    );
    expect(result.content[0].text).toContain('Incomplete listing:');
  });

  it('runs an admitted trace control inside its finite call budget', async () => {
    const post = vi.spyOn(client.http, 'post').mockRejectedValue(new Error('stop'));
    const result = await handlePinnedTrace(client, { action: 'trace_start', traceUser: 'MARIAN' }, writer);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ state: 'parameters-unconfirmed', target: 'A4H/001' });
    expect(post.mock.calls[0][4]?.deadline).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});
