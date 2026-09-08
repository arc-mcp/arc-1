import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { RELATIONS_MIME, RELATIONS_PATH } from '../../../src/adt/repository-relations.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { resetCachedFeatures, setCachedDiscovery } from '../../../src/handlers/feature-cache.js';
import { SAPNavigateSchema } from '../../../src/handlers/schemas.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { parseArgs, validateConfig } from '../../../src/server/config.js';
import { filterToolsByAuthScope, getConfiguredToolDefinitions } from '../../../src/server/server.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { relationMetadata, relationObject, relationXml } from '../../helpers/relation-fixtures.js';

const discovery = new Map([[RELATIONS_PATH, [RELATIONS_MIME]]]);
const root = relationObject('ZCL_ROOT'),
  child = relationObject('ZCL_CHILD');
const input = { action: 'relations', type: 'CLAS', name: 'ZCL_ROOT' };
const config = { ...DEFAULT_CONFIG, liveRelations: true };
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

describe('opt-in live relations integration', () => {
  it('has zero default schema change even when capability is available', () => {
    expect(getToolDefinitions(DEFAULT_CONFIG, undefined, undefined, { discoveryMap: discovery })).toEqual(
      getToolDefinitions(DEFAULT_CONFIG),
    );
    expect(navigation(getConfiguredToolDefinitions(DEFAULT_CONFIG)).inputSchema).not.toHaveProperty(
      'properties.direction',
    );
  });
  it('only adds opt-in fields when exact capability is known; denied action adds nothing', () => {
    expect(navigation(getToolDefinitions(config))).toEqual(navigation(getToolDefinitions(DEFAULT_CONFIG)));
    const enabled = getToolDefinitions(config, undefined, undefined, { discoveryMap: discovery });
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
    DEFAULT_CONFIG,
    { ...config, toolMode: 'hyperfocused' as const },
    { ...config, multiTargetEndpoints: true },
    { ...config, targetId: 'A4H/001' },
    { ...config, denyActions: ['SAPNavigate.relations'] },
  ])('blocks disabled/unsupported/denied invocation before SAP', async (settings) => {
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
    expect(
      SAPNavigateSchema.safeParse({ action: 'references', type: 'CLAS', name: 'ZCL_ROOT', depth: 2 }).success,
    ).toBe(false);
  });
  it('defaults off, accepts env/flag and rejects unsupported startup modes', () => {
    vi.stubEnv('ARC1_LIVE_RELATIONS', 'false');
    expect(parseArgs([]).liveRelations).toBe(false);
    vi.stubEnv('ARC1_LIVE_RELATIONS', 'true');
    expect(parseArgs([]).liveRelations).toBe(true);
    expect(parseArgs(['--live-relations=false']).liveRelations).toBe(false);
    expect(() => validateConfig({ ...config, toolMode: 'hyperfocused' })).toThrow('single-target standard');
    expect(() => validateConfig({ ...config, multiTargetEndpoints: true })).toThrow('single-target standard');
  });
});
