import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { getToolSchema } = await import('../../../src/handlers/schemas.js');
const { stripLlmEmptyValues } = await import('../../../src/handlers/object-types.js');

const target = { type: 'CLAS', name: 'ZCL_A' };
const objects = [target];
const unsupportedSelectors = [
  { ...target, url: '/sap/bc/adt/oo/classes/ZCL_B' },
  { ...target, url: '/sap/bc/adt/oo/classes/ZCL_A' },
  { url: '/sap/bc/adt/oo/classes/ZCL_A' },
  { objects, url: '/sap/bc/adt/oo/classes/ZCL_B' },
  { ...target, objects: [], url: '/sap/bc/adt/oo/classes/ZCL_B' },
];

function atcClient() {
  const client = createClient();
  const get = vi.spyOn(client.http, 'get').mockImplementation(async (path) => ({
    statusCode: 200,
    headers: {},
    body: path.includes('/atc/customizing')
      ? '<customizing><properties><property name="systemCheckVariant" value="ZCHECK"/></properties></customizing>'
      : path.includes('/atc/runs/')
        ? '<run status="Completed"/>'
        : '<worklist id="WL" objectSetIsComplete="true"><objects><object uri="/sap/bc/adt/oo/classes/ZCL_A" type="CLAS" name="ZCL_A"/></objects></worklist>',
  }));
  const post = vi
    .spyOn(client.http, 'post')
    .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: 'WL' })
    .mockResolvedValueOnce({ statusCode: 201, headers: { location: '/sap/bc/adt/atc/runs/RUN' }, body: '' });
  return { client, get, post };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

describe.each(['onprem', 'btp'] as const)('ATC selectors on %s', (systemType) => {
  const config = { ...DEFAULT_CONFIG, systemType };

  it.each(unsupportedSelectors)('rejects an unsupported URL in the runtime schema: %j', (selectors) => {
    const parsed = getToolSchema('SAPDiagnose', systemType === 'btp')?.safeParse({ action: 'atc', ...selectors });
    expect(parsed?.success).toBe(false);
  });

  it.each(unsupportedSelectors)('rejects an unsupported URL before any SAP request: %j', async (selectors) => {
    const { client, get, post } = atcClient();
    const result = await handleToolCall(client, config, 'SAPDiagnose', { action: 'atc', ...selectors });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid arguments');
    expect(result.content[0]?.text).toContain('url');
    expect(result.content[0]?.text).toContain('type');
    expect(result.content[0]?.text).toContain('name');
    expect(result.content[0]?.text).toContain('objects');
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', '  '])('treats URL filler %j as omitted for a single object', async (url) => {
    const { client, post } = atcClient();
    const result = await handleToolCall(client, config, 'SAPDiagnose', { action: 'atc', ...target, url });
    expect(result.isError).toBeUndefined();
    expect(post.mock.calls[0]?.[0]).toContain('/atc/worklists');
    expect(post.mock.calls[1]?.[0]).toContain('/atc/runs');
    expect(post.mock.calls[1]?.[1]).toContain('/sap/bc/adt/oo/classes/ZCL_A');
  });

  it.each([undefined, null, '', '  '])('accepts URL filler %j for a batch', (url) => {
    // The public dispatcher removes strict-client filler before validating the batch.
    const args = stripLlmEmptyValues({ action: 'atc', objects, url });
    expect(getToolSchema('SAPDiagnose', systemType === 'btp')?.safeParse(args).success).toBe(true);
  });

  it('keeps the documented OData URL selector', () => {
    expect(
      getToolSchema('SAPDiagnose', systemType === 'btp')?.safeParse({
        action: 'odata_perf',
        url: '/sap/opu/odata/sap/Z_SERVICE/Entity',
      }).success,
    ).toBe(true);
  });
});
