import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { canonicalDestinationUrl, opaqueDestinationValue } from '../../../src/server/destination-discovery.js';
import {
  DestinationRegistry,
  duplicateSingleTargetIds,
  sharedBasicSingleTargetConflicts,
} from '../../../src/server/destination-registry.js';
import { logger } from '../../../src/server/logger.js';
import { buildTargetCatalog, TARGET_CATALOG_DIAGNOSTIC_LIMIT } from '../../../src/server/multi-target-catalog.js';
import { hasAuthorizationLimitedFeatureEvidence } from '../../../src/server/multi-target-feature-state.js';
import { buildAggregateToolSurfaceConfig, buildMultiTargetConfig } from '../../../src/server/multi-target-runtime.js';
import { parseSapTargetsArguments } from '../../../src/server/multi-target-server.js';
import { createServer, resolveSingleTargetOverlapState } from '../../../src/server/server.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

type RequestHandler = (
  request: Record<string, unknown>,
  extra: { authInfo?: AuthInfo },
) => Promise<Record<string, any>>;

function requestHandler(server: Server, method: string): RequestHandler {
  const handlers = (server as unknown as { _requestHandlers: Map<string, RequestHandler> })._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`No request handler registered for ${method}`);
  return handler;
}

function registry(
  count: number,
  policy = { data: false, sql: false },
  options: { includeInvalid?: boolean; authentication?: 'PrincipalPropagation' | 'BasicAuthentication' } = {},
) {
  const canonicalUrl = canonicalDestinationUrl('http://sap.internal:50000') as string;
  const subaccount = Array.from({ length: count }, (_, index) => {
    const sid = `A${Math.floor(index / 10) % 10}${index % 10}`;
    const client = String(index).padStart(3, '0');
    return {
      name: `DEST_${index}`,
      type: 'HTTP',
      urlState: 'valid' as const,
      urlFingerprint: opaqueDestinationValue(`${canonicalUrl}${index}`),
      authentication: options.authentication ?? 'PrincipalPropagation',
      proxyType: 'OnPremise',
      sapSysId: sid,
      sapClient: client,
      description: `SAP target ${index}`,
      hasCloudConnectorLocationId: false,
      arcProperties: {
        'arc1.enabled': 'true',
        'arc1.allow_data_preview': String(policy.data),
        'arc1.allow_free_sql': String(policy.sql),
      },
    };
  });
  if (options.includeInvalid) {
    subaccount.push({
      name: 'DEST_INVALID',
      type: 'HTTP',
      urlState: 'valid' as const,
      urlFingerprint: opaqueDestinationValue(`${canonicalUrl}/private-sentinel`),
      authentication: 'PrincipalPropagation',
      proxyType: 'OnPremise',
      sapSysId: 'bad',
      sapClient: '100',
      description: 'Invalid target',
      hasCloudConnectorLocationId: false,
      arcProperties: {
        'arc1.enabled': 'true',
        'arc1.allow_data_preview': 'false',
        'arc1.allow_free_sql': 'false',
      },
    });
  }
  return DestinationRegistry.fromDiscovery(
    {
      subaccount,
      instanceNames: [],
      scannedCount: subaccount.length,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    {
      ...DEFAULT_CONFIG,
      allowDataPreview: policy.data,
      allowFreeSQL: policy.sql,
      multiTargetAllowBasicAuth: options.authentication === 'BasicAuthentication',
    },
  );
}

const readAuth: AuthInfo = {
  token: 'header.payload.signature',
  clientId: 'test-client',
  scopes: ['read'],
  extra: { userName: 'TEST_USER' },
};

const adminAuth: AuthInfo = { ...readAuth, scopes: ['admin'] };

function parseError(result: Record<string, any>) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('multi-target MCP servers', () => {
  it('parses the catalog arguments through one strict runtime contract', () => {
    expect(parseSapTargetsArguments({ query: 'A4H', offset: 50 }, true)).toEqual({
      ok: true,
      value: { query: 'A4H', offset: 50 },
    });
    expect(parseSapTargetsArguments({ offset: 0 }, false)).toMatchObject({ ok: false });
    expect(parseSapTargetsArguments({ extra: true }, true)).toMatchObject({ ok: false });
    expect(parseSapTargetsArguments({ query: null, offset: null }, false)).toEqual({ ok: true, value: {} });
    expect(parseSapTargetsArguments({ query: '   ', offset: null }, false)).toEqual({ ok: true, value: {} });
  });

  it('detects side-by-side single-target exposure by destination name or connection fingerprint', () => {
    const current = registry(2);
    expect(duplicateSingleTargetIds(current, ['DEST_0'])).toEqual(['A00/000']);
    expect(duplicateSingleTargetIds(current, [], current.targets[1].connectionFingerprint)).toEqual(['A01/001']);
    expect(duplicateSingleTargetIds(current, ['NOT_CONFIGURED'])).toEqual([]);
  });

  it('refuses only shared Basic overlap between bare and multi-target routes', () => {
    const basic = registry(2, undefined, { authentication: 'BasicAuthentication' });
    expect(sharedBasicSingleTargetConflicts(basic, 'DEST_0', undefined, true)).toEqual(['A00/000']);
    expect(sharedBasicSingleTargetConflicts(basic, 'DEST_0', undefined, false)).toEqual([]);
    // A PP-only destination name is not part of the shared bare-/mcp identity.
    // MTA extensions can leave this property configured after topology changes;
    // it must not make an unrelated shared single-target connection fail startup.
    expect(sharedBasicSingleTargetConflicts(basic, 'SINGLE_BASIC', undefined, true)).toEqual([]);

    const direct = resolveSingleTargetOverlapState(
      {
        ...DEFAULT_CONFIG,
        url: 'http://sap.internal:50000/0',
        client: '000',
        username: 'TECH_USER',
        password: 'PASSWORD',
      },
      undefined,
      false,
    );
    expect(
      sharedBasicSingleTargetConflicts(basic, undefined, direct.connectionFingerprint, direct.usesSharedBasic),
    ).toEqual(['A00/000']);

    const pp = registry(1);
    expect(sharedBasicSingleTargetConflicts(pp, 'DEST_0', undefined, true)).toEqual([]);
  });

  it('keeps the unfiltered 256-target admin catalog compact', () => {
    const payload = buildTargetCatalog(registry(256), { admin: true });
    expect(payload).toMatchObject({
      admin: { diagnosticMode: 'exceptions', destinations: [] },
    });
    expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBeLessThan(20_000);
  });

  it('summarizes normal shared-auth health and keeps the 256-target admin catalog compact', () => {
    const payload = buildTargetCatalog(
      registry(256, { data: false, sql: false }, { authentication: 'BasicAuthentication' }),
      {
        admin: true,
        runtimeAuth: () => ({ status: 'healthy', checkedAt: '2026-07-20T12:34:56.000Z' }),
      },
    ) as Record<string, any>;

    expect(payload.admin.sharedAuthentication).toEqual({ targets: 256, statusCounts: { healthy: 256 } });
    expect(payload.targets.every((entry: Record<string, unknown>) => !('runtimeAuth' in entry))).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBeLessThan(20_000);
  });

  it('counts an in-flight shared-auth check without reporting an administrator exception', () => {
    const payload = buildTargetCatalog(
      registry(1, { data: false, sql: false }, { authentication: 'BasicAuthentication' }),
      {
        admin: true,
        runtimeAuth: () => ({ status: 'checking', checkedAt: '2026-07-20T12:34:56.000Z' }),
      },
    ) as Record<string, any>;

    expect(payload.admin.sharedAuthentication).toEqual({ targets: 1, statusCounts: { checking: 1 } });
  });

  it('keeps exceptional shared-auth health on the affected target', () => {
    const payload = buildTargetCatalog(
      registry(2, { data: false, sql: false }, { authentication: 'BasicAuthentication' }),
      {
        admin: true,
        runtimeAuth: (target) =>
          target.endsWith('/001')
            ? { status: 'authentication_failed', checkedAt: '2026-07-20T12:34:56.000Z' }
            : { status: 'healthy', checkedAt: '2026-07-20T12:30:00.000Z' },
      },
    ) as Record<string, any>;

    expect(payload.admin.sharedAuthentication).toEqual({
      targets: 2,
      statusCounts: { healthy: 1, authentication_failed: 1 },
      exceptionTotal: 1,
      exceptionReturned: 1,
      exceptionsTruncated: false,
      exceptions: [
        {
          target: 'A01/001',
          status: 'authentication_failed',
          checkedAt: '2026-07-20T12:34:56.000Z',
        },
      ],
    });
    expect(payload.targets.every((entry: Record<string, unknown>) => !('runtimeAuth' in entry))).toBe(true);
  });

  it('bounds 256 exceptional shared-auth states and keeps the admin catalog compact', () => {
    const payload = buildTargetCatalog(
      registry(256, { data: false, sql: false }, { authentication: 'BasicAuthentication' }),
      {
        admin: true,
        runtimeAuth: () => ({ status: 'temporarily_unavailable', checkedAt: '2026-07-20T12:34:56.000Z' }),
      },
    ) as Record<string, any>;

    expect(payload.admin.sharedAuthentication).toMatchObject({
      targets: 256,
      statusCounts: { temporarily_unavailable: 256 },
      exceptionTotal: 256,
      exceptionReturned: 8,
      exceptionsTruncated: true,
    });
    expect(payload.admin.sharedAuthentication.exceptions).toHaveLength(8);
    expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBeLessThan(20_000);
  });

  it('bounds admin exception and broad-query diagnostics with explicit truncation metadata', () => {
    const overLimit = buildTargetCatalog(registry(257), { admin: true }) as Record<string, any>;
    expect(overLimit.admin).toMatchObject({
      state: 'error',
      diagnosticMode: 'exceptions',
      diagnosticOffset: 0,
      diagnosticTotal: 257,
      diagnosticReturned: TARGET_CATALOG_DIAGNOSTIC_LIMIT,
      diagnosticsTruncated: true,
      diagnosticNextOffset: TARGET_CATALOG_DIAGNOSTIC_LIMIT,
    });
    expect(overLimit.admin.destinations).toHaveLength(TARGET_CATALOG_DIAGNOSTIC_LIMIT);

    const nextPage = buildTargetCatalog(registry(257), {
      admin: true,
      offset: TARGET_CATALOG_DIAGNOSTIC_LIMIT,
    }) as Record<string, any>;
    expect(nextPage.admin).toMatchObject({
      diagnosticOffset: TARGET_CATALOG_DIAGNOSTIC_LIMIT,
      diagnosticTotal: 257,
      diagnosticReturned: TARGET_CATALOG_DIAGNOSTIC_LIMIT,
      diagnosticNextOffset: TARGET_CATALOG_DIAGNOSTIC_LIMIT * 2,
      diagnosticsTruncated: true,
    });
    expect(nextPage.admin.destinations[0]).not.toEqual(overLimit.admin.destinations[0]);

    const broadActiveQuery = buildTargetCatalog(registry(256), { admin: true, query: 'DEST_' }) as Record<string, any>;
    expect(broadActiveQuery.admin).toMatchObject({
      diagnosticMode: 'matching',
      diagnosticOffset: 0,
      diagnosticTotal: 256,
      diagnosticReturned: TARGET_CATALOG_DIAGNOSTIC_LIMIT,
      diagnosticsTruncated: true,
    });
    expect(broadActiveQuery.admin.destinations).toHaveLength(TARGET_CATALOG_DIAGNOSTIC_LIMIT);
  });

  it('keeps authorization-limited feature evidence in the unknown state', () => {
    const status = (id: string, message?: string) => ({ id, available: !message, mode: 'auto', message });
    const features = {
      hana: status('hana'),
      abapGit: status('abapGit'),
      gcts: status('gcts'),
      rap: status('rap', 'forbidden (403) — endpoint exists but user lacks authorization'),
      amdp: status('amdp'),
      ui5: status('ui5'),
      transport: status('transport'),
      ui5repo: status('ui5repo'),
      flp: status('flp'),
    };
    expect(hasAuthorizationLimitedFeatureEvidence(features)).toBe(true);
    expect(
      hasAuthorizationLimitedFeatureEvidence({
        ...features,
        rap: status('rap'),
        textSearch: { available: false, reason: 'ICF endpoint not found (404)' },
      }),
    ).toBe(false);
  });

  it('keeps a zero-target aggregate endpoint alive with no SAP tools', async () => {
    const current = registry(0);
    const server = createServer(buildAggregateToolSurfaceConfig(DEFAULT_CONFIG, current.targets), {
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig: DEFAULT_CONFIG },
    });
    const list = await requestHandler(server, ListToolsRequestSchema.shape.method.value)(
      { method: 'tools/list', params: {} },
      { authInfo: readAuth },
    );
    expect(list.tools).toEqual([]);

    const call = await requestHandler(server, CallToolRequestSchema.shape.method.value)(
      { method: 'tools/call', params: { name: 'SAPRead', arguments: { type: 'system', target: 'A00/000' } } },
      { authInfo: readAuth },
    );
    expect(parseError(call)).toMatchObject({ error: 'NO_TARGETS_CONFIGURED', retryable: false });

    const adminList = await requestHandler(server, ListToolsRequestSchema.shape.method.value)(
      { method: 'tools/list', params: {} },
      { authInfo: adminAuth },
    );
    expect(adminList.tools.map((tool: { name: string }) => tool.name)).toEqual(['SAPTargets']);
    const adminCatalog = await requestHandler(server, CallToolRequestSchema.shape.method.value)(
      { method: 'tools/call', params: { name: 'SAPTargets', arguments: {} } },
      { authInfo: adminAuth },
    );
    expect(JSON.parse(adminCatalog.content[0].text)).toMatchObject({
      targets: [],
      admin: { state: 'ready', counts: { active: 0 }, diagnosticMode: 'exceptions', destinations: [] },
    });
  });

  it('uses an exact aggregate enum and reserves SAPTargets at one target for admins', async () => {
    const current = registry(1);
    const server = createServer(buildAggregateToolSurfaceConfig(DEFAULT_CONFIG, current.targets), {
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig: DEFAULT_CONFIG },
    });
    const result = await requestHandler(server, ListToolsRequestSchema.shape.method.value)(
      { method: 'tools/list', params: {} },
      { authInfo: readAuth },
    );
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'SAPRead',
      'SAPSearch',
      'SAPNavigate',
      'SAPLint',
      'SAPDiagnose',
      'SAPContext',
      'SAPTransport',
    ]);
    const read = result.tools.find((tool: { name: string }) => tool.name === 'SAPRead');
    expect(read.inputSchema.properties.target.enum).toEqual(['A00/000']);
    expect(read.inputSchema.required).toContain('target');
    const transport = result.tools.find((tool: { name: string }) => tool.name === 'SAPTransport');
    expect(transport.inputSchema.properties.target.enum).toEqual(['A00/000']);
    expect(transport.inputSchema.required).toContain('target');

    const adminResult = await requestHandler(server, ListToolsRequestSchema.shape.method.value)(
      { method: 'tools/list', params: {} },
      { authInfo: adminAuth },
    );
    expect(adminResult.tools.map((tool: { name: string }) => tool.name)).toContain('SAPTargets');
  });

  it('keeps pinned schemas target-free', async () => {
    const current = registry(1);
    const target = current.targets[0];
    const server = createServer(buildMultiTargetConfig(DEFAULT_CONFIG, target), {
      multiTarget: { mode: 'pinned', registry: current, instanceConfig: DEFAULT_CONFIG, target },
    });
    const result = await requestHandler(server, ListToolsRequestSchema.shape.method.value)(
      { method: 'tools/list', params: {} },
      { authInfo: readAuth },
    );
    expect(result.tools.every((tool: any) => tool.inputSchema.properties.target === undefined)).toBe(true);
    const adminResult = await requestHandler(server, ListToolsRequestSchema.shape.method.value)(
      { method: 'tools/list', params: {} },
      { authInfo: adminAuth },
    );
    expect(adminResult.tools.map((tool: { name: string }) => tool.name)).not.toContain('SAPTargets');
  });

  it('lists multiple targets compactly for readers and expands diagnostics for admins', async () => {
    const auditSpy = vi.spyOn(logger, 'emitAudit');
    const current = registry(2, { data: true, sql: true }, { includeInvalid: true });
    const server = createServer(
      buildAggregateToolSurfaceConfig(
        { ...DEFAULT_CONFIG, allowDataPreview: true, allowFreeSQL: true },
        current.targets,
      ),
      {
        multiTarget: {
          mode: 'aggregate',
          registry: current,
          instanceConfig: { ...DEFAULT_CONFIG, allowDataPreview: true, allowFreeSQL: true },
        },
      },
    );
    const list = await requestHandler(server, ListToolsRequestSchema.shape.method.value)(
      { method: 'tools/list', params: {} },
      { authInfo: readAuth },
    );
    expect(list.tools.map((tool: { name: string }) => tool.name)).toContain('SAPTargets');

    const callTool = requestHandler(server, CallToolRequestSchema.shape.method.value);
    const reader = await callTool(
      { method: 'tools/call', params: { name: 'SAPTargets', arguments: { query: 'target 1' } } },
      { authInfo: readAuth },
    );
    expect(JSON.parse(reader.content[0].text)).toEqual([
      { target: 'A01/001', description: 'SAP target 1', identity: 'per-user' },
    ]);

    const admin = await callTool(
      { method: 'tools/call', params: { name: 'SAPTargets', arguments: {} } },
      { authInfo: adminAuth },
    );
    const adminPayload = JSON.parse(admin.content[0].text);
    expect(adminPayload).toMatchObject({
      targets: [
        { target: 'A00/000', description: 'SAP target 0', identity: 'per-user' },
        { target: 'A01/001', description: 'SAP target 1', identity: 'per-user' },
      ],
      admin: {
        state: 'degraded',
        counts: { active: 2, quarantined: 1 },
        diagnosticMode: 'exceptions',
        destinations: [{ destinationName: 'DEST_INVALID', code: 'INVALID_SYSID' }],
      },
    });
    expect(JSON.stringify(adminPayload)).not.toContain('private-sentinel');
    expect(JSON.stringify(adminPayload)).not.toContain('connectionFingerprint');

    const activeDetail = await callTool(
      { method: 'tools/call', params: { name: 'SAPTargets', arguments: { query: 'DEST_1' } } },
      { authInfo: adminAuth },
    );
    expect(JSON.parse(activeDetail.content[0].text)).toMatchObject({
      targets: [],
      admin: {
        diagnosticMode: 'matching',
        destinations: [{ destinationName: 'DEST_1', target: 'A01/001', status: 'active', code: 'ACTIVE' }],
      },
    });
    const startsAndEnds = auditSpy.mock.calls
      .map(([event]) => event)
      .filter((event) => event.event === 'tool_call_start' || event.event === 'tool_call_end');
    expect(startsAndEnds).toHaveLength(6);
    expect(startsAndEnds.every((event) => JSON.stringify(event).includes('target 1') === false)).toBe(true);
    auditSpy.mockRestore();
  });

  it('shows SAPQuery only when target consent, the instance ceiling, and user SQL scope all agree', async () => {
    const current = registry(2, { data: true, sql: true });
    const instanceConfig = { ...DEFAULT_CONFIG, allowDataPreview: true, allowFreeSQL: true };
    const server = createServer(buildAggregateToolSurfaceConfig(instanceConfig, current.targets), {
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig },
    });
    const listTools = requestHandler(server, ListToolsRequestSchema.shape.method.value);
    const names = async (scopes: string[]) => {
      const result = await listTools({ method: 'tools/list', params: {} }, { authInfo: { ...readAuth, scopes } });
      return result.tools.map((tool: { name: string }) => tool.name);
    };

    expect(await names(['read'])).not.toContain('SAPQuery');
    expect(await names(['read', 'sql'])).toContain('SAPQuery');
    expect(await names(['admin'])).toContain('SAPQuery');

    const noTargetConsent = registry(2, { data: true, sql: false });
    const ceilingOnly = createServer(buildAggregateToolSurfaceConfig(instanceConfig, noTargetConsent.targets), {
      multiTarget: { mode: 'aggregate', registry: noTargetConsent, instanceConfig },
    });
    const withoutConsent = await requestHandler(ceilingOnly, ListToolsRequestSchema.shape.method.value)(
      { method: 'tools/list', params: {} },
      { authInfo: { ...readAuth, scopes: ['read', 'sql'] } },
    );
    expect(withoutConsent.tools.map((tool: { name: string }) => tool.name)).not.toContain('SAPQuery');
  });

  it('keeps admin catalog diagnostics reachable when destination discovery fails', async () => {
    const current = DestinationRegistry.unavailable({ code: 'REGISTRY_DISCOVERY_ERROR', message: 'safe failure' });
    const server = createServer(buildAggregateToolSurfaceConfig(DEFAULT_CONFIG, current.targets), {
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig: DEFAULT_CONFIG },
    });
    const listTools = requestHandler(server, ListToolsRequestSchema.shape.method.value);
    expect((await listTools({ method: 'tools/list', params: {} }, { authInfo: readAuth })).tools).toEqual([]);
    expect(
      (await listTools({ method: 'tools/list', params: {} }, { authInfo: adminAuth })).tools.map(
        (tool: { name: string }) => tool.name,
      ),
    ).toEqual(['SAPTargets']);

    const catalog = await requestHandler(server, CallToolRequestSchema.shape.method.value)(
      { method: 'tools/call', params: { name: 'SAPTargets', arguments: {} } },
      { authInfo: adminAuth },
    );
    expect(JSON.parse(catalog.content[0].text)).toMatchObject({
      targets: [],
      admin: {
        state: 'error',
        failure: { code: 'REGISTRY_DISCOVERY_ERROR', message: 'safe failure' },
      },
    });
  });

  it('validates SAPTargets arguments and fails closed without read scope', async () => {
    const current = registry(2);
    const server = createServer(buildAggregateToolSurfaceConfig(DEFAULT_CONFIG, current.targets), {
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig: DEFAULT_CONFIG },
    });
    const callTool = requestHandler(server, CallToolRequestSchema.shape.method.value);
    const missingAuth = await callTool({ method: 'tools/call', params: { name: 'SAPTargets', arguments: {} } }, {});
    expect(parseError(missingAuth)).toMatchObject({ error: 'INSUFFICIENT_SCOPE' });

    for (const arguments_ of [
      { query: 42 },
      { query: 'x'.repeat(161) },
      { offset: -1 },
      { offset: 1.5 },
      { offset: 1_000_001 },
      { offset: 0 },
      { unexpected: true },
    ]) {
      const result = await callTool(
        { method: 'tools/call', params: { name: 'SAPTargets', arguments: arguments_ } },
        { authInfo: readAuth },
      );
      expect(parseError(result)).toMatchObject({ error: 'INVALID_ARGUMENTS', retryable: false });
    }

    const adminPage = await callTool(
      { method: 'tools/call', params: { name: 'SAPTargets', arguments: { offset: 0 } } },
      { authInfo: adminAuth },
    );
    expect(adminPage.isError).not.toBe(true);
    expect(JSON.parse(adminPage.content[0].text)).toMatchObject({ admin: { diagnosticOffset: 0 } });
  });

  it('hides and blocks SAPTargets when denied by the instance policy', async () => {
    const current = registry(2);
    const instanceConfig = { ...DEFAULT_CONFIG, denyActions: ['SAPTargets'] };
    const server = createServer(buildAggregateToolSurfaceConfig(instanceConfig, current.targets), {
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig },
    });
    const listed = await requestHandler(server, ListToolsRequestSchema.shape.method.value)(
      { method: 'tools/list', params: {} },
      { authInfo: readAuth },
    );
    expect(listed.tools.map((tool: { name: string }) => tool.name)).not.toContain('SAPTargets');
    const direct = await requestHandler(server, CallToolRequestSchema.shape.method.value)(
      { method: 'tools/call', params: { name: 'SAPTargets', arguments: {} } },
      { authInfo: readAuth },
    );
    expect(parseError(direct)).toMatchObject({ error: 'MULTI_TARGET_OPERATION_FORBIDDEN' });
  });

  it('rate-limits SAPTargets once per authenticated call', async () => {
    const current = registry(2);
    const limiter = {
      consume: vi.fn().mockResolvedValue({ allowed: false, retryAfterMs: 2_500, limitPerMinute: 120 }),
    };
    const server = createServer(buildAggregateToolSurfaceConfig(DEFAULT_CONFIG, current.targets), {
      mcpRateLimiter: limiter,
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig: DEFAULT_CONFIG },
    });
    const result = await requestHandler(server, CallToolRequestSchema.shape.method.value)(
      { method: 'tools/call', params: { name: 'SAPTargets', arguments: {} } },
      { authInfo: readAuth },
    );
    expect(parseError(result)).toMatchObject({ error: 'rate_limited', retryAfter: 3, retryable: true });
    expect(limiter.consume).toHaveBeenCalledOnce();
    expect(limiter.consume).toHaveBeenCalledWith('TEST_USER', 'SAPTargets');
  });

  it('rejects hidden mutation tools and target policy before constructing PP', async () => {
    const auditSpy = vi.spyOn(logger, 'emitAudit');
    const current = registry(1);
    const server = createServer(buildAggregateToolSurfaceConfig(DEFAULT_CONFIG, current.targets), {
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig: DEFAULT_CONFIG },
    });
    const handler = requestHandler(server, CallToolRequestSchema.shape.method.value);
    const write = await handler(
      {
        method: 'tools/call',
        params: { name: 'SAPWrite', arguments: { action: 'update', target: 'A00/000' } },
      },
      { authInfo: readAuth },
    );
    expect(parseError(write)).toMatchObject({ error: 'MULTI_TARGET_OPERATION_FORBIDDEN', target: 'A00/000' });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'safety_blocked',
        target: 'A00/000',
        operation: 'SAPWrite.update',
        reason: 'Operation unavailable in read-only multi-target v1',
      }),
    );

    const sql = await handler(
      { method: 'tools/call', params: { name: 'SAPQuery', arguments: { sql: 'SELECT *', target: 'A00/000' } } },
      { authInfo: { ...readAuth, scopes: ['read', 'sql'] } },
    );
    expect(parseError(sql)).toMatchObject({ error: 'TARGET_POLICY_DENIED', target: 'A00/000' });
    auditSpy.mockRestore();
  });

  it('audits SAP_DENY_ACTIONS for an otherwise allowed target operation', async () => {
    const current = registry(1);
    const instanceConfig = { ...DEFAULT_CONFIG, denyActions: ['SAPRead.SYSTEM'] };
    const server = createServer(buildAggregateToolSurfaceConfig(instanceConfig, current.targets), {
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig },
    });
    const auditSpy = vi.spyOn(logger, 'emitAudit');
    const result = await requestHandler(server, CallToolRequestSchema.shape.method.value)(
      { method: 'tools/call', params: { name: 'SAPRead', arguments: { type: 'system', target: 'A00/000' } } },
      { authInfo: readAuth },
    );
    const payload = parseError(result);
    expect(payload).toMatchObject({ error: 'MULTI_TARGET_OPERATION_FORBIDDEN', target: 'A00/000' });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'safety_blocked',
        requestId: payload.requestId,
        target: 'A00/000',
        operation: 'SAPRead.SYSTEM',
        reason: 'Action denied by SAP_DENY_ACTIONS',
      }),
    );
    auditSpy.mockRestore();
  });

  it('checks functional XSUAA scope before target policy or PP', async () => {
    const current = registry(1, { data: true, sql: true });
    const instanceConfig = { ...DEFAULT_CONFIG, allowDataPreview: true, allowFreeSQL: true };
    const server = createServer(buildAggregateToolSurfaceConfig(instanceConfig, current.targets), {
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig },
    });
    const result = await requestHandler(server, CallToolRequestSchema.shape.method.value)(
      { method: 'tools/call', params: { name: 'SAPQuery', arguments: { sql: 'SELECT *', target: 'A00/000' } } },
      { authInfo: readAuth },
    );
    expect(parseError(result)).toMatchObject({ error: 'INSUFFICIENT_SCOPE', target: 'A00/000' });
  });

  it('enforces the per-user MCP limit before principal propagation and consumes once', async () => {
    const current = registry(1);
    const deniedLimiter = {
      consume: async () => ({ allowed: false as const, retryAfterMs: 12_000, limitPerMinute: 60 }),
    };
    const deniedServer = createServer(buildAggregateToolSurfaceConfig(DEFAULT_CONFIG, current.targets), {
      mcpRateLimiter: deniedLimiter,
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig: DEFAULT_CONFIG },
    });
    const denied = await requestHandler(deniedServer, CallToolRequestSchema.shape.method.value)(
      { method: 'tools/call', params: { name: 'SAPRead', arguments: { type: 'SYSTEM', target: 'A00/000' } } },
      { authInfo: readAuth },
    );
    expect(parseError(denied)).toMatchObject({
      error: 'rate_limited',
      target: 'A00/000',
      retryAfter: 12,
      retryable: true,
    });

    let allowedConsumes = 0;
    const auditSpy = vi.spyOn(logger, 'emitAudit');
    const allowedLimiter = {
      consume: async () => {
        allowedConsumes += 1;
        return { allowed: true as const };
      },
    };
    const allowedServer = createServer(buildAggregateToolSurfaceConfig(DEFAULT_CONFIG, current.targets), {
      mcpRateLimiter: allowedLimiter,
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig: DEFAULT_CONFIG },
    });
    const allowed = await requestHandler(allowedServer, CallToolRequestSchema.shape.method.value)(
      { method: 'tools/call', params: { name: 'SAPRead', arguments: { type: 'SYSTEM', target: 'A00/000' } } },
      { authInfo: readAuth },
    );
    const allowedError = parseError(allowed);
    expect(allowedError).toMatchObject({ error: 'PP_SETUP_FAILED', target: 'A00/000' });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth_pp_created',
        requestId: allowedError.requestId,
        target: 'A00/000',
        success: false,
      }),
    );
    expect(allowedConsumes).toBe(1);
    auditSpy.mockRestore();
  });
});
