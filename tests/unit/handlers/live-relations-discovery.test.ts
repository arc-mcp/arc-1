import { XMLParser } from 'fast-xml-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { RELATIONS_MIME, RELATIONS_PATH } from '../../../src/adt/repository-relations.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { getCachedDiscovery, resetCachedFeatures, setCachedDiscovery } from '../../../src/handlers/feature-cache.js';
import { getConfiguredToolDefinitions } from '../../../src/server/server.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { relationMetadata, relationObject, relationXml } from '../../helpers/relation-fixtures.js';

const discoveryPath = '/sap/bc/adt/discovery';
const discoveryXml = `<service><workspace><collection href="${RELATIONS_PATH}"><accept>${RELATIONS_MIME}</accept></collection></workspace></service>`;
const discovery = new Map([[RELATIONS_PATH, [RELATIONS_MIME]]]);
const root = relationObject('ZCL_ROOT');
const input = { action: 'relations', type: 'CLAS', name: root.name };
const config = { ...DEFAULT_CONFIG, liveRelations: true, destinationName: 'SYSTEM_A' };
const readAuth = { token: 'local-test', clientId: 'reader', scopes: ['read'] };
const response = (body: string) => ({ statusCode: 200, headers: {}, body });
function setup() {
  const client = new AdtClient({ baseUrl: 'http://not-contacted.invalid' });
  const get = vi
    .spyOn(client.http, 'get')
    .mockImplementation(async (path) => response(path === discoveryPath ? discoveryXml : relationMetadata(root)));
  const post = vi.spyOn(client.http, 'post').mockResolvedValue(response(relationXml(root, [])));
  return { client, get, post };
}

beforeEach(resetCachedFeatures);
afterEach(() => {
  resetCachedFeatures();
  vi.restoreAllMocks();
});

describe('live relations cold discovery reuse', () => {
  it('parses discovery once and reuses only capabilities on the next call', async () => {
    const { client, get, post } = setup();
    const parse = vi.spyOn(XMLParser.prototype, 'parse');
    expect(
      getConfiguredToolDefinitions(config).find((tool) => tool.name === 'SAPNavigate')!.inputSchema,
    ).not.toHaveProperty('properties.direction');
    for (let call = 0; call < 2; call++) {
      expect((await handleToolCall(client, config, 'SAPNavigate', input, readAuth)).isError).toBeUndefined();
    }
    expect(parse.mock.calls.filter(([xml]) => xml === discoveryXml)).toHaveLength(1);
    expect(get.mock.calls.map(([path]) => path)).toEqual([discoveryPath, root.uri, root.uri]);
    expect(post).toHaveBeenCalledTimes(2);
    expect(getCachedDiscovery(config.destinationName)).toEqual(discovery);
    expect(getCachedDiscovery()).toEqual(new Map());
    expect(
      getConfiguredToolDefinitions(config).find((tool) => tool.name === 'SAPNavigate')!.inputSchema,
    ).toHaveProperty('properties.direction');
  });

  it('never treats cached capabilities as another user’s object authorization', async () => {
    const allowed = setup(),
      denied = setup();
    expect((await handleToolCall(allowed.client, config, 'SAPNavigate', input, readAuth)).isError).toBeUndefined();
    denied.get.mockRejectedValue(new AdtApiError('Forbidden', 403, root.uri));
    const result = await handleToolCall(denied.client, config, 'SAPNavigate', input, {
      ...readAuth,
      clientId: 'denied-user',
    });
    expect(result.isError).toBe(true);
    expect(denied.get.mock.calls.map(([path]) => path)).toEqual([root.uri]);
    expect(denied.post).not.toHaveBeenCalled();
    expect(result.content[0]!.text).not.toContain('"nodes"');
  });

  it('does not reuse SYSTEM_A capability discovery for SYSTEM_B', async () => {
    const first = setup(),
      second = setup();
    expect((await handleToolCall(first.client, config, 'SAPNavigate', input, readAuth)).isError).toBeUndefined();
    second.get.mockResolvedValue(response('<service><workspace/></service>'));
    const result = await handleToolCall(
      second.client,
      { ...config, destinationName: 'SYSTEM_B' },
      'SAPNavigate',
      input,
      readAuth,
    );
    expect(result.isError).toBe(true);
    expect(second.get.mock.calls.map(([path]) => path)).toEqual([discoveryPath]);
    expect(getCachedDiscovery('SYSTEM_A')).toEqual(discovery);
    expect(getCachedDiscovery('SYSTEM_B').size).toBe(0);
    expect(second.post).not.toHaveBeenCalled();
  });

  it.each([
    ['unsupported', '<service><workspace/></service>'],
    ['malformed', discoveryXml.slice(0, -10)],
    ['DTD', `<!DOCTYPE service>${discoveryXml}`],
    ['wrong MIME', discoveryXml.replace(RELATIONS_MIME, 'text/plain')],
  ])('does not publish %s discovery or poison the next attempt', async (_label, xml) => {
    const { client, get, post } = setup();
    get.mockResolvedValueOnce(response(xml));
    expect((await handleToolCall(client, config, 'SAPNavigate', input, readAuth)).isError).toBe(true);
    expect(getCachedDiscovery(config.destinationName).size).toBe(0);
    expect(post).not.toHaveBeenCalled();
    expect((await handleToolCall(client, config, 'SAPNavigate', input, readAuth)).isError).toBeUndefined();
    expect(get.mock.calls.map(([path]) => path)).toEqual([discoveryPath, discoveryPath, root.uri]);
    expect(getCachedDiscovery(config.destinationName)).toEqual(discovery);
  });

  it.each([401, 403, 500])('does not cache HTTP %i discovery failure', async (status) => {
    const { client, get } = setup();
    get.mockRejectedValueOnce(new AdtApiError('Discovery failed', status, discoveryPath));
    expect((await handleToolCall(client, config, 'SAPNavigate', input, readAuth)).isError).toBe(true);
    expect(getCachedDiscovery(config.destinationName).size).toBe(0);
    expect((await handleToolCall(client, config, 'SAPNavigate', input, readAuth)).isError).toBeUndefined();
    expect(getCachedDiscovery(config.destinationName)).toEqual(discovery);
  });

  it('does not overwrite a discovery refresh completed while the fallback was in flight', async () => {
    const { client, get } = setup();
    const newer = new Map([['/sap/bc/adt/oo/classes', ['application/example+xml']]]);
    get.mockImplementationOnce(async () => {
      setCachedDiscovery(newer, config.destinationName);
      return response(discoveryXml);
    });
    expect((await handleToolCall(client, config, 'SAPNavigate', input, readAuth)).isError).toBeUndefined();
    expect(getCachedDiscovery(config.destinationName)).toBe(newer);
  });

  it('respects a named destination’s known absence without fetching fallback discovery', async () => {
    const { client, get, post } = setup();
    setCachedDiscovery(new Map([['/sap/bc/adt/oo/classes', ['application/example+xml']]]), config.destinationName);
    expect((await handleToolCall(client, config, 'SAPNavigate', input, readAuth)).isError).toBe(true);
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
