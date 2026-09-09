import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError, AdtNetworkError, AdtResponseLimitError } from '../../../src/adt/errors.js';
import * as featuresModule from '../../../src/adt/features.js';
import {
  parseRelationXml,
  RELATION_XML_MAX_BYTES,
  RELATIONS_MIME,
  RELATIONS_PATH,
} from '../../../src/adt/repository-relations.js';
import { AdtRequestBudgetError } from '../../../src/adt/request-attempt-budget.js';
import { Semaphore } from '../../../src/adt/semaphore.js';
import { RELATION_LIMITS } from '../../../src/context/relation-walk.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { getCachedDiscovery, resetCachedFeatures, setCachedDiscovery } from '../../../src/handlers/feature-cache.js';
import { normalizeTypeArgsForValidation } from '../../../src/handlers/object-types.js';
import { SAPNavigateSchema } from '../../../src/handlers/schemas.js';
import * as usages from '../../../src/handlers/where-used.js';
import { logger } from '../../../src/server/logger.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { relationMetadata, relationObject, relationXml } from '../../helpers/relation-fixtures.js';
import { features } from './handler-test-config.js';

const root = relationObject('ZCL_ROOT'),
  child = relationObject('ZCL_CHILD');
const input = { action: 'relations', type: 'CLAS', name: root.name };
const config = { ...DEFAULT_CONFIG };
const discovery = new Map([[RELATIONS_PATH, [RELATIONS_MIME]]]);
const response = (body: string) => ({ statusCode: 200, headers: {}, body });
function setup() {
  const client = new AdtClient({ baseUrl: 'https://not-contacted.invalid' });
  const get = vi.spyOn(client.http, 'get').mockResolvedValue(response(relationMetadata(root)));
  const post = vi.spyOn(client.http, 'post').mockResolvedValue(response(relationXml(root, [child])));
  return { client, get, post };
}
beforeEach(() => {
  resetCachedFeatures();
  setCachedDiscovery(discovery);
});
afterEach(() => {
  resetCachedFeatures();
  vi.restoreAllMocks();
});

describe('full external-review regressions', () => {
  it('reports attempt exhaustion without network/retry advice and with a distinct audit class', async () => {
    const { client, get } = setup();
    get.mockRejectedValue(new AdtRequestBudgetError(12));
    const audit = vi.spyOn(logger, 'emitAudit');
    const result = await handleToolCall(client, config, 'SAPNavigate', input);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Narrow');
    expect(result.content[0]!.text).not.toMatch(/Cannot reach|SAPRead|retrying/);
    expect(
      audit.mock.calls.some(([event]) => 'errorClass' in event && event.errorClass === 'AdtRequestBudgetError'),
    ).toBe(true);
  });

  it('preserves a complete walk whose final processing crosses the deadline', async () => {
    const { client, post } = setup();
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    post.mockImplementation(async () => {
      now += RELATION_LIMITS.deadlineMs + 10;
      return response(relationXml(root, []));
    });
    const result = await handleToolCall(client, config, 'SAPNavigate', input);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      truncated: true,
      truncationReasons: ['deadline'],
      expanded: [root.uri],
      pending: [],
    });
  });

  it('reports deadline exhaustion before any evidence without a connectivity-probe hint', async () => {
    const { client, get } = setup();
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    get.mockImplementation(async () => {
      now += RELATION_LIMITS.deadlineMs + 1;
      throw new AdtNetworkError('The ADT request deadline was exceeded.');
    });
    const result = await handleToolCall(client, config, 'SAPNavigate', input);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('analysis time limit');
    expect(result.content[0]!.text).not.toContain('SAPRead');
  });

  it('keeps caller cancellation terminal even after node truncation', async () => {
    const { client, post } = setup();
    const controller = new AbortController();
    post.mockImplementation(async () => {
      controller.abort();
      return response(relationXml(root, [child]));
    });
    const result = await handleToolCall(
      client,
      config,
      'SAPNavigate',
      { ...input, maxResults: 1 },
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      controller.signal,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).not.toContain('"nodes"');
  });

  it('classifies an expired admission wait and releases the two active slots', async () => {
    const acquire = vi.spyOn(Semaphore.prototype, 'acquire');
    const fixtures = [setup(), setup(), setup()];
    const complete: Array<() => void> = [];
    for (const f of fixtures.slice(0, 2))
      f.post.mockImplementation(
        () =>
          new Promise((resolve) => {
            complete.push(() => resolve(response(relationXml(root, []))));
          }),
      );
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const first = fixtures.slice(0, 2).map((f) => handleToolCall(f.client, config, 'SAPNavigate', input));
    await vi.waitFor(() => expect(complete).toHaveLength(2));
    const audit = vi.spyOn(logger, 'emitAudit');
    const queued = handleToolCall(fixtures[2]!.client, config, 'SAPNavigate', input);
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(3));
    now += RELATION_LIMITS.deadlineMs + 1;
    timeout.abort(new DOMException('Time limit', 'TimeoutError'));
    try {
      const result = await queued;
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('analysis time limit');
      expect(result.content[0]!.text).not.toContain('Cannot reach');
      expect(fixtures[2]!.get).not.toHaveBeenCalled();
      expect(
        audit.mock.calls.some(([event]) => 'errorClass' in event && event.errorClass === 'AdtAnalysisDeadlineError'),
      ).toBe(true);
    } finally {
      for (const finish of complete) finish();
      await Promise.all(first);
    }
  });

  it.each(['references', 'definition', 'completion', 'hierarchy'])(
    'normalizes strict-client relation placeholders away from %s',
    (action) => {
      const cleaned = normalizeTypeArgsForValidation('SAPNavigate', {
        action,
        type: 'CLAS',
        name: root.name,
        depth: 0,
        expandPackages: [],
        direction: 'outgoing',
      });
      expect(SAPNavigateSchema.safeParse(cleaned).success).toBe(true);
      for (const key of ['depth', 'expandPackages', 'direction']) expect(cleaned).not.toHaveProperty(key);
    },
  );

  it('lets a polluted references call reach its actual handler', async () => {
    const { client } = setup();
    const refs = vi
      .spyOn(usages, 'lookupLiveUsages')
      .mockResolvedValue({ results: [], total: 0, truncated: false, fallbackUsed: false });
    const result = await handleToolCall(client, config, 'SAPNavigate', {
      action: 'references',
      type: 'CLAS',
      name: root.name,
      depth: 0,
      expandPackages: [],
      direction: 'outgoing',
    });
    expect(result.isError).toBeUndefined();
    expect(refs).toHaveBeenCalled();
  });

  it.each([[2], [], true, false, {}].map((value) => ({ value })))(
    'rejects non-scalar numeric input %j for real relations',
    ({ value }) => {
      for (const key of ['depth', 'maxResults']) {
        const args = normalizeTypeArgsForValidation('SAPNavigate', { ...input, [key]: value });
        expect(SAPNavigateSchema.safeParse(args).success).toBe(false);
      }
    },
  );

  it.each([false, true])('manual probe refreshes discovery only for the shared client, PP=%s', async (perUser) => {
    const { client } = setup();
    const absent = new Map([['/sap/bc/adt/oo/classes', ['application/xml']]]);
    setCachedDiscovery(absent);
    vi.spyOn(featuresModule, 'probeFeatures').mockResolvedValue({ ...features(), discoveryMap: discovery });
    const result = await handleToolCall(
      client,
      config,
      'SAPManage',
      { action: 'probe' },
      undefined,
      undefined,
      undefined,
      perUser,
    );
    expect(result.isError).toBeUndefined();
    expect(getCachedDiscovery()).toEqual(perUser ? absent : discovery);
  });

  it('shares the transport/parser byte ceiling and distinguishes unsupported markup', () => {
    expect(RELATION_LIMITS.bytes).toBe(RELATION_XML_MAX_BYTES);
    expect(() => parseRelationXml('x'.repeat(RELATION_XML_MAX_BYTES + 1))).toThrow(AdtResponseLimitError);
    expect(() => parseRelationXml('<root><!-- comment --></root>')).toThrow('comments');
  });

  it('gives actionable redirect guidance without disclosing SAP bodies', async () => {
    const { client, get } = setup();
    get.mockRejectedValue(
      new AdtApiError('Redirects are not allowed during bounded SAP analysis.', 302, root.uri, 'SECRET SAML BODY'),
    );
    const result = await handleToolCall(client, { ...config, minimalErrors: true }, 'SAPNavigate', input);
    expect(result.content[0]!.text).toContain('authenticated SAP session');
    expect(result.content[0]!.text).not.toContain('SECRET');
  });
});
