import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { normalizeTypeArgsForValidation } = await import('../../../src/handlers/object-types.js');
const { SAPDiagnoseSchema } = await import('../../../src/handlers/schemas.js');
const { getToolDefinitions } = await import('../../../src/handlers/tools.js');

const { requestContext } = await import('../../../src/server/context.js');
const client = () =>
  new AdtClient({ baseUrl: 'http://sap:8000', username: 'test', password: 'test', safety: defaultSafetyConfig() });
const objects = [
  { type: 'CLAS', name: 'ZCL_A' },
  { type: 'CLAS', name: 'ZCL_B' },
];
const row = (name: string) => `<object uri="/sap/bc/adt/atc/objects/R3TR/CLAS/${name}" type="CLAS" name="${name}"/>`;
function mockRun(missing = false) {
  let run = 0;
  mockFetch.mockImplementation(async (url: string | URL, options?: { method?: string }) => {
    const path = new URL(String(url)).pathname;
    const method = options?.method ?? 'GET';
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'T' });
    if (path.endsWith('/customizing'))
      return mockResponse(200, '<customizing><property name="systemCheckVariant" value="DEFAULT"/></customizing>');
    if (method === 'POST' && path.endsWith('/worklists')) return mockResponse(200, `WL${++run}`);
    if (method === 'POST' && path.endsWith('/runs'))
      return mockResponse(201, '', { location: `/sap/bc/adt/atc/runs/R${run}` });
    if (path.includes('/runs/')) return mockResponse(200, '<run status="Completed"/>');
    return mockResponse(
      200,
      `<worklist id="WL${run}" objectSetIsComplete="true"><objects>${row('ZCL_A')}${missing ? '' : row('ZCL_B')}</objects></worklist>`,
    );
  });
}

describe('SAPDiagnose ATC batch contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs with read-only safety and normalizes nested aliases, names and duplicates', async () => {
    mockRun();
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPDiagnose', {
      action: 'atc',
      objects: [{ type: ' clas/oc ', name: ' zcl_a ' }, ...objects],
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0]!.text as string)).toMatchObject({
      complete: true,
      requestedObjectCount: 3,
      uniqueObjectCount: 2,
    });
    const postBodies = mockFetch.mock.calls
      .filter((call) => String(call[0]).includes('/runs?'))
      .map((call) => call[1].body as string);
    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]?.match(/<adtcore:objectReference /g)).toHaveLength(2);
  });

  it.each(['legacy', 'structured'])('preserves incomplete coverage in %s format', async (resultFormat) => {
    mockRun(true);
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPDiagnose', {
      action: 'atc',
      objects,
      resultFormat,
    });
    expect(result.isError === true).toBe(resultFormat === 'legacy');
    const data = JSON.parse(result.content[0]!.text as string);
    expect(data).toMatchObject({ complete: false, verificationAttempted: true });
    expect(data.coverage[1]).toMatchObject({ status: 'notReported', findingCount: null });
  });

  it.each([
    { objects: [] },
    { objects: Array(21).fill(objects[0]) },
    { objects: [{ type: 'DEVC', name: '$TMP' }] },
    { objects: [{ type: 'UNKNOWN', name: 'Z_A' }] },
    { objects: [{ type: 'FUNC', name: 'Z_A' }] },
    { objects: [{ type: 'TABL/DS', name: 'Z_A' }] },
    { objects: [{ type: 'CLAS', name: '../Z_A' }] },
    { objects: [{ type: 'CLAS', name: 'Z"/><evil/>' }] },
    { objects: [{ type: 'CLAS', name: 'A'.repeat(41) }] },
    { objects: [{ type: 'CLAS', name: 'Z_A', target: 'OTHER' }] },
    { objects: [null] },
    { objects: [[]] },
    { objects: [{ type: 'CLAS', name: 123 }] },
    { objects: [{ name: 'Z_A' }] },
    { action: 'unittest', objects },
    { objects, name: 'Z_A' },
    { objects, type: 'CLAS' },
    { objects, url: '/sap/bc/adt/oo/classes/Z_A' },
    { objects, resultFormat: 'junit' },
  ])('rejects invalid/ambiguous input before SAP calls: %j', async (input) => {
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPDiagnose', { action: 'atc', ...input });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps server action denial effective for the entire batch', async () => {
    const result = await handleToolCall(
      client(),
      { ...DEFAULT_CONFIG, denyActions: ['SAPDiagnose.atc'] },
      'SAPDiagnose',
      { action: 'atc', objects },
    );
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('passes MCP cancellation to the batch executor and every SAP request', async () => {
    mockRun();
    const controller = new AbortController();
    const c = client();
    const get = vi.spyOn(c.http, 'get');
    await requestContext.run({ requestId: 'BATCH-CANCEL', signal: controller.signal }, () =>
      handleToolCall(c, DEFAULT_CONFIG, 'SAPDiagnose', { action: 'atc', objects }),
    );
    expect(get.mock.calls.length).toBeGreaterThan(0);
    expect(get.mock.calls.every((call) => call[2]?.signal === controller.signal)).toBe(true);
  });

  it('accepts a namespace and the exact limit after normalization', () => {
    const input = normalizeTypeArgsForValidation('SAPDiagnose', {
      action: 'atc',
      objects: Array(20).fill({ type: 'CLAS/OC', name: '/ARC/CL_A' }),
    });
    expect(SAPDiagnoseSchema.safeParse(input).success).toBe(true);
  });

  it('advertises strict item properties and the same array limits to clients', () => {
    const tool = getToolDefinitions(DEFAULT_CONFIG).find((item) => item.name === 'SAPDiagnose')!;
    expect((tool.inputSchema.properties as Record<string, unknown>).objects).toMatchObject({
      minItems: 1,
      maxItems: 20,
      items: { additionalProperties: false, required: ['type', 'name'] },
    });
  });
});
