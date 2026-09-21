import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError, AdtResponseLimitError } from '../../../src/adt/errors.js';
import { RELATIONS_MIME, RELATIONS_PATH } from '../../../src/adt/repository-relations.js';
import { AdtRequestBudgetError } from '../../../src/adt/request-attempt-budget.js';
import { RELATION_LIMITS } from '../../../src/context/relation-walk.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { resetCachedFeatures, setCachedDiscovery } from '../../../src/handlers/feature-cache.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { relationMetadata, relationObject, relationXml } from '../../helpers/relation-fixtures.js';

const root = relationObject('Z_ROOT');
const child = relationObject('Z_CHILD');
const input = { action: 'relations', type: 'CLAS', name: root.name, depth: 3, maxResults: 20 };
const response = (body: string) => ({ statusCode: 200, headers: {}, body });
function setup() {
  const client = new AdtClient({ baseUrl: 'http://not-contacted.invalid' });
  const get = vi.spyOn(client.http, 'get').mockResolvedValue(response(relationMetadata(root)));
  const post = vi.spyOn(client.http, 'post').mockResolvedValue(response(relationXml(root, [])));
  return { client, get, post };
}
async function run(client: AdtClient, args: Record<string, unknown> = input) {
  const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPNavigate', args);
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]!.text);
}
beforeEach(() => {
  resetCachedFeatures();
  setCachedDiscovery(new Map([[RELATIONS_PATH, [RELATIONS_MIME]]]));
});
afterEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
});

describe('live relation evidence summary', () => {
  it('does not equate a completed empty network with complete system coverage', async () => {
    const { client, get, post } = setup();
    const result = await run(client);
    expect(result.summary).toBe(
      'Returned 1 nodes (including root) and 0 edges; expanded 1 nodes; 0 nodes still queued. ' +
        'Resource truncation: none. Scope boundary counts: depth=0, type=0, package=0, missing=0. ' +
        'Configured limits are ceilings, not observed counts. System-wide coverage is unknown.',
    );
    expect(result.coverage).toBe('unknown');
    expect(result.truncated).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('reports expansion exhaustion below the node ceiling without inventing a package limit', async () => {
    const { client, post } = setup();
    const children = Array.from({ length: 12 }, (_, i) => relationObject(`Z_${i}`));
    post.mockResolvedValueOnce(response(relationXml(root, children)));
    for (const node of [...children].sort((a, b) => a.uri.localeCompare(b.uri))) {
      post.mockResolvedValueOnce(response(relationXml(node, [])));
    }
    const result = await run(client);
    expect(result.summary).toContain(
      'Returned 13 nodes (including root) and 12 edges; expanded 8 nodes; 5 nodes still queued.',
    );
    expect(result.summary).toContain('Resource truncation: expansions.');
    expect(result.summary).toContain('package=0');
    expect(result.truncationReasons).toEqual(['expansions']);
    expect(result.limits.nodes).toBe(20);
    expect(post).toHaveBeenCalledTimes(8);
  });

  it('distinguishes depth scope from node truncation even at exactly the node ceiling', async () => {
    const { client, post } = setup();
    post.mockResolvedValue(response(relationXml(root, [child])));
    const exact = await run(client, { ...input, depth: 1, maxResults: 2 });
    expect(exact.summary).toContain('Resource truncation: none. Scope boundary counts: depth=1');
    const capped = await run(client, { ...input, depth: 1, maxResults: 1 });
    expect(capped.summary).toContain('Returned 1 nodes (including root) and 0 edges;');
    expect(capped.summary).toContain('Resource truncation: nodes. Scope boundary counts: depth=0');
  });

  it('counts type, package and disappeared-node boundaries separately', async () => {
    const { client, post } = setup();
    const foreign = relationObject('Z_FOREIGN', 'CLAS/OC', 'OTHER');
    const unsupported = { ...relationObject('Z_EXTRA'), type: 'DDLX/EX', uri: '/sap/bc/adt/ddic/ddlx/sources/z_extra' };
    post.mockResolvedValueOnce(response(relationXml(root, [child, foreign, unsupported])));
    post.mockRejectedValueOnce(new AdtApiError('Gone', 404, ''));
    const result = await run(client, { ...input, expandPackages: [root.package] });
    expect(result.summary).toContain(
      'Resource truncation: none. Scope boundary counts: depth=0, type=1, package=1, missing=1',
    );
    expect(result.summary).toContain('0 nodes still queued.');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['requests', new AdtRequestBudgetError(12)],
    ['bytes', new AdtResponseLimitError(1048576, 1048577, 'repository-relations')],
  ])('names partial %s exhaustion without claiming the node ceiling was hit', async (reason, error) => {
    const { client, post } = setup();
    post.mockResolvedValueOnce(response(relationXml(root, [child]))).mockRejectedValueOnce(error);
    const result = await run(client);
    expect(result.summary).toContain(
      'Returned 2 nodes (including root) and 1 edges; expanded 1 nodes; 1 nodes still queued.',
    );
    expect(result.summary).toContain(`Resource truncation: ${reason}.`);
    expect(result.truncationReasons).toEqual([reason]);
  });

  it('reports the edge cap from actual discarded edges', async () => {
    const { client, post } = setup();
    const children = Array.from({ length: 100 }, (_, i) => relationObject(`Z_${i}`));
    post.mockResolvedValueOnce(response(relationXml(root, children)));
    for (const node of [...children].sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0))) {
      post.mockResolvedValueOnce(response(relationXml(node, [root])));
    }
    const result = await run(client, { ...input, maxResults: RELATION_LIMITS.nodes });
    expect(result.truncationReasons).toContain('edges');
    expect(result.summary).toContain(`${result.edges.length} edges;`);
    expect(result.summary).toContain(`Resource truncation: ${result.truncationReasons.join(', ')}.`);
    expect(result.edges).toHaveLength(RELATION_LIMITS.edges);
  });
});
