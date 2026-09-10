import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { RELATIONS_MIME, RELATIONS_PATH } from '../../../src/adt/repository-relations.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { resetCachedFeatures, setCachedDiscovery } from '../../../src/handlers/feature-cache.js';
import { SAPNavigateSchema } from '../../../src/handlers/schemas.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { CLI_CONFIG_OPTION_SPECS, parseArgs } from '../../../src/server/config.js';
import { filterToolsByAuthScope, getConfiguredToolDefinitions } from '../../../src/server/server.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { relationMetadata, relationObject, relationXml } from '../../helpers/relation-fixtures.js';

const discovery = new Map([[RELATIONS_PATH, [RELATIONS_MIME]]]);
const root = relationObject('ZCL_ROOT'),
  child = relationObject('ZCL_CHILD');
const input = { action: 'relations', type: 'CLAS', name: 'ZCL_ROOT' };
const config = { ...DEFAULT_CONFIG };
const readAuth = { token: 'local-test', clientId: 'reader', scopes: ['read'] };
const setup = () => {
  const client = new AdtClient({ baseUrl: 'http://not-contacted.invalid' });
  const get = vi
    .spyOn(client.http, 'get')
    .mockResolvedValue({ statusCode: 200, headers: {}, body: relationMetadata(root) });
  const post = vi
    .spyOn(client.http, 'post')
    .mockResolvedValue({ statusCode: 200, headers: {}, body: relationXml(root, [child]) });
  return { client, get, post };
};
const navigation = (defs: ReturnType<typeof getToolDefinitions>) => defs.find((tool) => tool.name === 'SAPNavigate')!;
beforeEach(() => {
  resetCachedFeatures();
  setCachedDiscovery(discovery);
});
afterEach(() => {
  resetCachedFeatures();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('automatic live relations integration', () => {
  it.each([401, 403])('keeps HTTP %i terminal after successful expansion and oversized error body', async (status) => {
    let networks = 0;
    const server = createServer((req, res) => {
      if (req.method === 'HEAD') {
        res.setHeader('x-csrf-token', 'TEST');
        res.end();
      } else if (req.method === 'GET') res.end(relationMetadata(root));
      else if (++networks === 1) res.end(relationXml(root, [child]));
      else {
        res.writeHead(status);
        res.end('x'.repeat(2 * 1024 * 1024));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected loopback listener');
      const client = new AdtClient({ baseUrl: `http://127.0.0.1:${address.port}` });
      const result = await handleToolCall(client, config, 'SAPNavigate', { ...input, depth: 2 }, readAuth);
      expect(result.isError).toBe(true);
      expect(networks).toBe(2);
      expect(result.content[0]!.text).not.toContain('"nodes"');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('automatically exposes the same action before and after supported discovery', () => {
    expect(getToolDefinitions(DEFAULT_CONFIG, undefined, undefined, { discoveryMap: discovery })).toEqual(
      getToolDefinitions(DEFAULT_CONFIG),
    );
    expect(navigation(getConfiguredToolDefinitions(DEFAULT_CONFIG)).inputSchema).toHaveProperty('properties.direction');
    expect(navigation(getToolDefinitions(DEFAULT_CONFIG)).description).toContain('package neighborhoods');
  });
  it('shows fields while capability is unknown; unsupported and denied actions add nothing', () => {
    const enabled = getToolDefinitions(config, undefined, undefined, { discoveryMap: discovery });
    expect(navigation(getToolDefinitions(config))).toEqual(navigation(enabled));
    expect(navigation(enabled).description).toMatch(/^Experimental relations: dependency/);
    expect(navigation(enabled).description).toContain('objectType="CLAS/OC" for class-only requests');
    expect(navigation(enabled).description).toContain('otherwise omit.');
    expect(navigation(enabled).inputSchema).toHaveProperty(
      'properties.type.description',
      expect.stringContaining('TTYP=table type; MSAG=message class'),
    );
    expect(
      navigation(
        getToolDefinitions(config, undefined, undefined, {
          discoveryMap: new Map([['/sap/bc/adt/oo/classes', ['application/xml']]]),
        }),
      ),
    ).toEqual(navigation(getToolDefinitions({ ...DEFAULT_CONFIG, denyActions: ['SAPNavigate.relations'] })));
    expect(navigation(enabled).inputSchema).toHaveProperty('properties.action.enum', [
      'definition',
      'references',
      'completion',
      'hierarchy',
      'relations',
    ]);
    expect(
      navigation(
        getToolDefinitions({ ...config, denyActions: ['SAPNavigate.rel*'] }, undefined, undefined, {
          discoveryMap: discovery,
        }),
      ).inputSchema,
    ).not.toHaveProperty('properties.direction');
    expect(filterToolsByAuthScope(enabled, ['read']).some((tool) => tool.name === 'SAPNavigate')).toBe(true);
    expect(filterToolsByAuthScope(enabled, []).some((tool) => tool.name === 'SAPNavigate')).toBe(false);
  });
  it.each([
    { ...config, toolMode: 'hyperfocused' as const },
    { ...config, multiTargetEndpoints: true },
    { ...config, targetId: 'A4H/001' },
    { ...config, denyActions: ['SAPNavigate.relations'] },
  ])('blocks unsupported-mode/denied invocation before SAP', async (settings) => {
    const listed = JSON.stringify(getConfiguredToolDefinitions(settings));
    expect(listed).not.toContain('"relations"');
    expect(listed).not.toContain('Experimental relations:');
    const { client, get, post } = setup();
    expect((await handleToolCall(client, settings, 'SAPNavigate', input, readAuth)).isError).toBe(true);
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
  it('enforces read scope before SAP', async () => {
    const { client, get } = setup();
    expect((await handleToolCall(client, config, 'SAPNavigate', input, { ...readAuth, scopes: [] })).isError).toBe(
      true,
    );
    expect(get).not.toHaveBeenCalled();
  });
  it('returns bounded metadata-only output via real dispatch', async () => {
    const { client, get, post } = setup();
    const result = await handleToolCall(client, config, 'SAPNavigate', input, readAuth);
    expect(result.isError).toBeUndefined();
    const value = JSON.parse(result.content[0]!.text);
    expect(value).toMatchObject({
      experimental: true,
      coverage: 'unknown',
      truncated: false,
      version: 'active',
      direction: 'outgoing',
      limits: { requests: 12, concurrent: 2 },
    });
    expect(value.nodes).toHaveLength(2);
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]![0]).toBe(root.uri);
    expect(value.nodes[0].existence).toBe('metadata_validated');
  });
  it.each([401, 403, 404])('propagates root HTTP %i as tool error, without native lookup', async (status) => {
    const { client, get, post } = setup();
    get.mockRejectedValue(new AdtApiError('Failure', status, root.uri));
    expect((await handleToolCall(client, config, 'SAPNavigate', input, readAuth)).isError).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });
  it('does not reuse another per-user client result', async () => {
    const allowed = setup(),
      denied = setup();
    denied.get.mockRejectedValue(new AdtApiError('Forbidden for second user', 403, root.uri));
    expect(
      (await handleToolCall(allowed.client, config, 'SAPNavigate', input, readAuth, undefined, undefined, true))
        .isError,
    ).toBeUndefined();
    expect(
      (
        await handleToolCall(
          denied.client,
          config,
          'SAPNavigate',
          input,
          { ...readAuth, clientId: 'second' },
          undefined,
          undefined,
          true,
        )
      ).isError,
    ).toBe(true);
    expect(denied.get).toHaveBeenCalledTimes(1);
    expect(denied.post).not.toHaveBeenCalled();
  });
  it('admits at most two full analyses across independent clients', async () => {
    let active = 0,
      peak = 0;
    const clients = Array.from({ length: 8 }, () => {
      const fixture = setup();
      fixture.post.mockImplementation(async () => {
        active++;
        peak = Math.max(active, peak);
        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { statusCode: 200, headers: {}, body: relationXml(root, [child]) };
        } finally {
          active--;
        }
      });
      return fixture.client;
    });
    const results = await Promise.all(
      clients.map((client) => handleToolCall(client, config, 'SAPNavigate', input, readAuth)),
    );
    expect(results.every((result) => !result.isError)).toBe(true);
    expect(peak).toBe(2);
  });
  it('propagates a pre-cancelled caller without SAP work', async () => {
    const { client, get } = setup();
    const result = await handleToolCall(
      client,
      config,
      'SAPNavigate',
      input,
      readAuth,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      AbortSignal.abort(),
    );
    expect(result.isError).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('relations input/config contract', () => {
  it.each([
    { type: 'DEVC' },
    { type: '' },
    { name: '../evil' },
    { name: 'X'.repeat(121) },
    { uri: root.uri },
    { source: 'code' },
    { depth: 0 },
    { depth: 4 },
    { maxResults: 0 },
    { maxResults: 101 },
    { maxResults: 1.5 },
    { direction: 'both' },
    { expandPackages: ['Z*'] },
    { expandPackages: Array(9).fill('Z') },
  ])('rejects invalid relations input %j', (fields) => {
    expect(SAPNavigateSchema.safeParse({ ...input, ...fields }).success).toBe(false);
  });
  it('accepts bounded coercible options and namespaced roots', () => {
    expect(
      SAPNavigateSchema.safeParse({
        ...input,
        name: '/ACME/CL_TEST',
        depth: '3',
        maxResults: '100',
        expandPackages: ['$TMP'],
      }).success,
    ).toBe(true);
  });
  it('has no dedicated configuration switch', () => {
    vi.stubEnv('ARC1_LIVE_RELATIONS', 'false');
    expect(parseArgs([])).not.toHaveProperty('liveRelations');
    vi.stubEnv('ARC1_LIVE_RELATIONS', 'true');
    expect(parseArgs([])).not.toHaveProperty('liveRelations');
    expect(CLI_CONFIG_OPTION_SPECS.some((flag) => flag.name === 'live-relations')).toBe(false);
  });
});
