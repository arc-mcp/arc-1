/**
 * ADR-0008 — opt-in writes on pinned multi-target routes, at the MCP request-handler level.
 *
 * Effective write permission = instance ceiling ∧ destination opt-in ∧ Principal Propagation ∧
 * pinned route ∧ XSUAA scope ∧ SAP authorization. These cases cover every ARC-1-side gate:
 * route (aggregate stays mutation-free), scope, transport/Git sub-ceilings, deny actions, the
 * instance ceiling, and identity (shared Basic never writes).
 *
 * Destination drift of the write keys (`arc1.allow_writes` changing after startup →
 * TARGET_CONFIG_CHANGED) is covered at the runtime-unit level in
 * tests/unit/server/multi-target-runtime.test.ts ("reports TARGET_CONFIG_CHANGED when
 * arc1.allow_writes changes after startup"), because the per-user client path needs a BTP binding.
 * The live drift check is part of the Task 11 BTP verification.
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { canonicalDestinationUrl, opaqueDestinationValue } from '../../../src/server/destination-discovery.js';
import { DestinationRegistry, type TargetDescriptor } from '../../../src/server/destination-registry.js';
import { buildAggregateToolSurfaceConfig, buildMultiTargetConfig } from '../../../src/server/multi-target-runtime.js';
import { buildMultiTargetServerInstructions } from '../../../src/server/multi-target-server.js';
import { createServer } from '../../../src/server/server.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

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

const WRITE_PROPS = Object.freeze({
  'arc1.allow_writes': 'true',
  'arc1.allowed_packages': '$TMP,ZTEAM*',
});

function registry(
  instance: ServerConfig,
  options: {
    writeProps?: Record<string, string>;
    authentication?: 'PrincipalPropagation' | 'BasicAuthentication';
  } = {},
) {
  const canonicalUrl = canonicalDestinationUrl('http://sap.internal:50000') as string;
  const subaccount = [
    {
      name: 'DEST_0',
      type: 'HTTP',
      urlState: 'valid' as const,
      urlFingerprint: opaqueDestinationValue(`${canonicalUrl}0`),
      authentication: options.authentication ?? 'PrincipalPropagation',
      proxyType: 'OnPremise',
      sapSysId: 'A00',
      sapClient: '000',
      description: 'SAP target 0',
      hasCloudConnectorLocationId: false,
      arcProperties: {
        'arc1.enabled': 'true',
        'arc1.allow_data_preview': 'false',
        'arc1.allow_free_sql': 'false',
        ...(options.writeProps ?? {}),
      },
    },
  ];
  return DestinationRegistry.fromDiscovery(
    {
      subaccount,
      instanceNames: [],
      scannedCount: subaccount.length,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    instance,
  );
}

function onlyTarget(current: DestinationRegistry): TargetDescriptor {
  expect(current.targets).toHaveLength(1);
  const target = current.targets[0];
  if (!target) throw new Error('expected one accepted target');
  return target;
}

function pinnedServer(instance: ServerConfig, current: DestinationRegistry, target: TargetDescriptor) {
  return createServer(buildMultiTargetConfig(instance, target, 'pinned'), {
    multiTarget: { mode: 'pinned', registry: current, instanceConfig: instance, target },
  });
}

async function listToolNames(server: Server, authInfo: AuthInfo): Promise<string[]> {
  const result = await requestHandler(server, ListToolsRequestSchema.shape.method.value)(
    { method: 'tools/list', params: {} },
    { authInfo },
  );
  return result.tools.map((tool: { name: string }) => tool.name);
}

async function callTool(server: Server, name: string, args: Record<string, unknown>, authInfo: AuthInfo) {
  return requestHandler(server, CallToolRequestSchema.shape.method.value)(
    { method: 'tools/call', params: { name, arguments: args } },
    { authInfo },
  );
}

function parseError(result: Record<string, any>) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

const readAuth: AuthInfo = {
  token: 'header.payload.signature',
  clientId: 'test-client',
  scopes: ['read'],
  extra: { userName: 'TEST_USER' },
};
const writeAuth: AuthInfo = { ...readAuth, scopes: ['read', 'write'] };
const adminAuth: AuthInfo = { ...readAuth, scopes: ['admin'] };

const instance: ServerConfig = { ...DEFAULT_CONFIG, multiTargetAllowWrites: true };

const CREATE_ARGS = Object.freeze({
  action: 'create',
  type: 'CLAS',
  name: 'ZCL_ARC1_X',
  package: '$TMP',
  source: 'CLASS zcl_arc1_x DEFINITION PUBLIC. ENDCLASS. CLASS zcl_arc1_x IMPLEMENTATION. ENDCLASS.',
});

const WRITE_TOOLS = ['SAPWrite', 'SAPActivate', 'SAPManage'];

describe('ADR-0008 pinned multi-target writes', () => {
  it('keeps the aggregate route mutation-free even for a writable target', async () => {
    const current = registry(instance, { writeProps: WRITE_PROPS });
    expect(onlyTarget(current).effectivePolicy.allowWrites).toBe(true);
    const server = createServer(buildAggregateToolSurfaceConfig(instance, current.targets), {
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig: instance },
    });
    expect(await listToolNames(server, writeAuth)).not.toContain('SAPWrite');
    const result = await callTool(server, 'SAPWrite', { ...CREATE_ARGS, target: 'A00/000' }, writeAuth);
    expect(result.isError).toBe(true);
    expect(parseError(result)).toMatchObject({ error: 'MULTI_TARGET_OPERATION_FORBIDDEN' });
  });

  it('lists the write tools on a writable pinned route only for write-scoped callers', async () => {
    const current = registry(instance, { writeProps: WRITE_PROPS });
    const server = pinnedServer(instance, current, onlyTarget(current));

    const writer = await listToolNames(server, writeAuth);
    for (const tool of WRITE_TOOLS) expect(writer).toContain(tool);
    expect(writer).not.toContain('SAPTargets');

    const readerList = await requestHandler(server, ListToolsRequestSchema.shape.method.value)(
      { method: 'tools/list', params: {} },
      { authInfo: readAuth },
    );
    const reader = readerList.tools.map((tool: { name: string }) => tool.name);
    expect(reader).not.toContain('SAPWrite');
    expect(reader).not.toContain('SAPActivate');
    expect(reader).toContain('SAPRead');
    expect(reader).not.toContain('SAPTargets');
    // Single-target parity: SAPManage stays listed for readers, pruned to its read-scoped actions only.
    const manage = readerList.tools.find((tool: { name: string }) => tool.name === 'SAPManage');
    const manageActions: string[] = manage?.inputSchema.properties.action.enum ?? [];
    expect(manageActions.length).toBeGreaterThan(0);
    for (const action of ['create_package', 'delete_package', 'change_package']) {
      expect(manageActions).not.toContain(action);
    }
  });

  it('still requires the write scope for SAPWrite', async () => {
    const current = registry(instance, { writeProps: WRITE_PROPS });
    const server = pinnedServer(instance, current, onlyTarget(current));
    const result = await callTool(server, 'SAPWrite', CREATE_ARGS, readAuth);
    expect(result.isError).toBe(true);
    expect(parseError(result)).toMatchObject({ error: 'INSUFFICIENT_SCOPE' });
  });

  it('requires the transports scope for a transport mutation when the transport ceiling is on', async () => {
    const config = { ...instance, multiTargetAllowTransportWrites: true };
    const current = registry(config, { writeProps: { ...WRITE_PROPS, 'arc1.allow_transport_writes': 'true' } });
    const target = onlyTarget(current);
    expect(target.effectivePolicy.allowTransportWrites).toBe(true);
    const server = pinnedServer(config, current, target);
    const result = await callTool(server, 'SAPTransport', { action: 'create', description: 'ARC-1 test' }, writeAuth);
    expect(result.isError).toBe(true);
    expect(parseError(result)).toMatchObject({ error: 'INSUFFICIENT_SCOPE' });
    expect(parseError(result).message).toContain("Scope 'transports'");
  });

  it('requires the git scope for a Git mutation when the Git ceiling is on', async () => {
    const config = { ...instance, multiTargetAllowGitWrites: true };
    const current = registry(config, { writeProps: { ...WRITE_PROPS, 'arc1.allow_git_writes': 'true' } });
    const target = onlyTarget(current);
    expect(target.effectivePolicy.allowGitWrites).toBe(true);
    const server = pinnedServer(config, current, target);
    const result = await callTool(
      server,
      'SAPGit',
      { action: 'pull', backend: 'abapgit', repoId: 'REPO_1', package: '$TMP' },
      writeAuth,
    );
    expect(result.isError).toBe(true);
    expect(parseError(result)).toMatchObject({ error: 'INSUFFICIENT_SCOPE' });
    expect(parseError(result).message).toContain("Scope 'git'");
  });

  it('refuses a transport mutation when only the destination (not the instance) enables it', async () => {
    const current = registry(instance, { writeProps: { ...WRITE_PROPS, 'arc1.allow_transport_writes': 'true' } });
    const target = onlyTarget(current);
    expect(target.requestedPolicy.allowTransportWrites).toBe(true);
    expect(target.effectivePolicy.allowTransportWrites).toBe(false);
    const server = pinnedServer(instance, current, target);
    const result = await callTool(
      server,
      'SAPTransport',
      { action: 'create', description: 'ARC-1 test' },
      { ...readAuth, scopes: ['read', 'write', 'transports'] },
    );
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error).toMatchObject({ error: 'MULTI_TARGET_OPERATION_FORBIDDEN' });
    expect(error.message).toContain('not enabled for target A00/000');
  });

  it('applies instance deny actions on a writable pinned route', async () => {
    const config = { ...instance, denyActions: ['SAPWrite.delete'] };
    const current = registry(config, { writeProps: WRITE_PROPS });
    const server = pinnedServer(config, current, onlyTarget(current));
    const result = await callTool(
      server,
      'SAPWrite',
      { action: 'delete', type: 'CLAS', name: 'ZCL_ARC1_X' },
      writeAuth,
    );
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error).toMatchObject({ error: 'MULTI_TARGET_OPERATION_FORBIDDEN' });
    expect(error.message).toBe('This operation is disabled by the ARC-1 instance policy.');
  });

  it('keeps the pinned route read-only when the instance write ceiling is off', async () => {
    const current = registry(DEFAULT_CONFIG, { writeProps: WRITE_PROPS });
    const target = onlyTarget(current);
    expect(target.requestedPolicy.allowWrites).toBe(true);
    expect(target.effectivePolicy.allowWrites).toBe(false);
    const server = pinnedServer(DEFAULT_CONFIG, current, target);
    const names = await listToolNames(server, writeAuth);
    for (const tool of WRITE_TOOLS) expect(names).not.toContain(tool);
    expect(names).toContain('SAPRead');
    expect(
      buildMultiTargetServerInstructions({ mode: 'pinned', registry: current, instanceConfig: DEFAULT_CONFIG, target }),
    ).toContain('read-only interface');
  });

  it('quarantines a shared Basic destination that requests writes', async () => {
    const config = { ...instance, multiTargetAllowBasicAuth: true };
    const current = registry(config, { writeProps: WRITE_PROPS, authentication: 'BasicAuthentication' });
    expect(current.targets).toEqual([]);
    expect(current.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destinationName: 'DEST_0',
          status: 'quarantined',
          code: 'WRITE_REQUIRES_PRINCIPAL_PROPAGATION',
        }),
      ]),
    );

    const aggregate = createServer(buildAggregateToolSurfaceConfig(config, current.targets), {
      multiTarget: { mode: 'aggregate', registry: current, instanceConfig: config },
    });
    const catalog = await callTool(aggregate, 'SAPTargets', {}, adminAuth);
    expect(catalog.content[0].text).toContain('WRITE_REQUIRES_PRINCIPAL_PROPAGATION');
  });

  it('never opens the write surface on a pinned shared identity, even if its descriptor claims writes', async () => {
    // A quarantined Basic destination never reaches the registry; this synthetic descriptor proves the
    // route-bound ceiling and the tool surface still refuse writes if one ever did.
    const ppCurrent = registry(instance, { writeProps: WRITE_PROPS });
    const pp = onlyTarget(ppCurrent);
    const shared: TargetDescriptor = { ...pp, authentication: 'BasicAuthentication', identity: 'shared' };
    expect(shared.effectivePolicy.allowWrites).toBe(true);
    const config = buildMultiTargetConfig(instance, shared, 'pinned');
    expect(config.allowWrites).toBe(false);
    expect(config.allowTransportWrites).toBe(false);
    expect(config.allowGitWrites).toBe(false);

    const server = createServer(config, {
      multiTarget: { mode: 'pinned', registry: ppCurrent, instanceConfig: instance, target: shared },
    });
    const names = await listToolNames(server, writeAuth);
    for (const tool of WRITE_TOOLS) expect(names).not.toContain(tool);
    const result = await callTool(server, 'SAPWrite', CREATE_ARGS, writeAuth);
    expect(result.isError).toBe(true);
    expect(parseError(result)).toMatchObject({ error: 'MULTI_TARGET_OPERATION_FORBIDDEN' });
  });
});
