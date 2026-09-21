import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { normalizeTypeArgsForValidation } = await import('../../../src/handlers/object-types.js');
const { SAPDiagnoseSchema } = await import('../../../src/handlers/schemas.js');

type ObjectRef = { type: string; name: string };
const domain = { type: 'DOMA', name: 'ZDOMAIN' };
const element = { type: 'DTEL', name: 'ZELEMENT' };
const table = { type: 'TABL', name: 'ZTABLE' };
const structure = { type: 'TABL', name: 'ZSTRUCTURE' };
const refs = [domain, element, table, structure];
const uri = (object: ObjectRef) => `/sap/bc/adt/atc/objects/R3TR/${object.type}/${encodeURIComponent(object.name)}`;
function mockRuns(runs: ObjectRef[][], findingOwner?: ObjectRef) {
  let index = 0;
  mockFetch.mockImplementation(async (url: string | URL, options?: { method?: string }) => {
    const path = new URL(String(url)).pathname;
    const method = options?.method ?? 'GET';
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'T' });
    if (path.endsWith('/customizing'))
      return mockResponse(200, '<customizing><property name="systemCheckVariant" value="DEFAULT"/></customizing>');
    if (method === 'POST' && path.endsWith('/worklists')) return mockResponse(200, `WL${++index}`);
    if (method === 'POST' && path.endsWith('/runs'))
      return mockResponse(201, '', { location: `/sap/bc/adt/atc/runs/R${index}` });
    if (path.includes('/runs/')) return mockResponse(200, '<run status="Completed"/>');
    if (path.includes('/worklists/')) {
      const rows = (runs[index - 1] ?? [])
        .map((object) => {
          const finding =
            findingOwner?.type === object.type && findingOwner.name === object.name
              ? '<findings><finding priority="2" checkTitle="DDIC" messageTitle="Review dictionary definition"/></findings>'
              : '';
          return `<object type="${object.type}" name="${object.name}" uri="${uri(object)}">${finding}</object>`;
        })
        .join('');
      return mockResponse(
        200,
        `<worklist id="WL${index}" objectSetIsComplete="true"><objects>${rows}</objects></worklist>`,
      );
    }
    throw new Error(`Unexpected SAP call: ${method} ${path}`);
  });
}
async function diagnose(objects: ObjectRef[], extra: Record<string, unknown> = {}) {
  const client = new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'test',
    password: 'test',
    safety: defaultSafetyConfig(),
  });
  const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPDiagnose', { action: 'atc', objects, ...extra });
  return { result, data: JSON.parse(result.content[0]!.text as string) };
}

describe('DDIC ATC batch support (#770)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['TABL', 'TABL/DT', 'TABL/DS', 'DTEL', 'DTEL/DE', 'DOMA', 'DOMA/DD'])(
    'accepts %s and submits the canonical R3TR reference',
    async (type) => {
      const canonical = type.split('/')[0]!;
      const object = { type: canonical, name: 'ZDICTIONARY' };
      mockRuns([[object]]);
      const { result, data } = await diagnose([{ type: type.toLowerCase(), name: ' zdictionary ' }]);
      expect(result.isError).not.toBe(true);
      expect(data).toMatchObject({ complete: true, reportedObjectCount: 1, findingCount: 0 });
      expect(data.coverage[0]).toMatchObject({ ...object, uri: uri(object), status: 'reported', findingCount: 0 });
      const run = mockFetch.mock.calls.find((call) => String(call[0]).includes('/runs?'))!;
      expect(run[1].body).toContain(`adtcore:uri="${uri(object)}"`);
      expect(mockFetch.mock.calls.some((call) => String(call[0]).includes('/ddic/'))).toBe(false);
    },
  );

  it('mixes a domain, data element, table and structure with ownership and no metadata probes', async () => {
    mockRuns([refs], domain);
    const { result, data } = await diagnose(refs);
    expect(result.isError).not.toBe(true);
    expect(data).toMatchObject({ complete: true, uniqueObjectCount: 4, findingCount: 1, verificationAttempted: false });
    expect(data.coverage.map((object: { findingCount: number }) => object.findingCount)).toEqual([1, 0, 0, 0]);
    expect(data.findings[0]).toMatchObject({ object: { type: 'DOMA', name: 'ZDOMAIN' }, worklistId: 'WL1' });
    expect(mockFetch.mock.calls.filter((call) => String(call[0]).includes('/runs?'))).toHaveLength(1);
  });

  it('combines DDIC and existing class selections without changing the class URI', async () => {
    const clas = { type: 'CLAS', name: 'ZCL_TEST' };
    mockRuns([[...refs, clas]], domain);
    const { data } = await diagnose([...refs, clas]);
    expect(data).toMatchObject({ complete: true, uniqueObjectCount: 5, findingCount: 1 });
    const run = mockFetch.mock.calls.find((call) => String(call[0]).includes('/runs?'))!;
    expect(run[1].body).toContain('/sap/bc/adt/oo/classes/ZCL_TEST');
    expect(run[1].body).not.toContain('/sap/bc/adt/atc/objects/R3TR/CLAS/ZCL_TEST');
    for (const object of refs) expect(run[1].body).toContain(uri(object));
  });

  it('keeps a same-named domain and data element distinct but deduplicates TABL aliases', async () => {
    const selections = [{ type: 'DOMA', name: 'ZNAME' }, { type: 'DTEL', name: 'ZNAME' }, table];
    mockRuns([selections]);
    const { data } = await diagnose([
      ...selections,
      { type: 'TABL/DT', name: table.name },
      { type: 'TABL/DS', name: table.name },
    ]);
    expect(data).toMatchObject({ complete: true, requestedObjectCount: 5, uniqueObjectCount: 3 });
    const run = mockFetch.mock.calls.find((call) => String(call[0]).includes('/runs?'))!;
    expect(run[1].body.match(/<adtcore:objectReference /g)).toHaveLength(3);
  });

  it.each(['TABL', 'DTEL', 'DOMA'])('preserves namespace encoding for %s', async (type) => {
    const object = { type, name: '/ARC/DICTIONARY' };
    mockRuns([[object]]);
    const { data } = await diagnose([object]);
    expect(data.complete).toBe(true);
    expect(data.coverage[0].uri).toContain('/%2FARC%2FDICTIONARY');
    const run = mockFetch.mock.calls.find((call) => String(call[0]).includes('/runs?'))!;
    expect(run[1].body).toContain('/%2FARC%2FDICTIONARY');
  });

  it('verifies only omitted DDIC objects using the same reference form', async () => {
    mockRuns([[table], [domain, element, structure]], table);
    const { data } = await diagnose(refs);
    expect(data).toMatchObject({
      complete: true,
      reportedObjectCount: 4,
      findingCount: 1,
      verificationAttempted: true,
    });
    const runs = mockFetch.mock.calls.filter((call) => String(call[0]).includes('/runs?'));
    expect(runs).toHaveLength(2);
    expect(runs[1]![1].body).not.toContain(uri(table));
    for (const object of [domain, element, structure]) expect(runs[1]![1].body).toContain(uri(object));
  });

  it.each(['legacy', 'structured'])('keeps a missing DDIC object unknown in %s output', async (resultFormat) => {
    mockRuns([[table], []], table);
    const { result, data } = await diagnose([table, domain], { resultFormat });
    expect(result.isError === true).toBe(resultFormat === 'legacy');
    expect(data).toMatchObject({ complete: false, findingCount: 1, verificationAttempted: true });
    expect(data.coverage[1]).toMatchObject({ type: 'DOMA', status: 'notReported', findingCount: null });
  });

  it('does not attribute a same-named data element record to a requested domain', async () => {
    const wrong = { type: 'DTEL', name: domain.name };
    mockRuns([[table, wrong], [wrong]]);
    const { data } = await diagnose([table, domain]);
    expect(data.complete).toBe(false);
    expect(data.coverage[1]).toMatchObject({ type: 'DOMA', status: 'notReported', findingCount: null });
  });

  it.each(['../ZBAD', 'Z"/><evil/>', '/ARC/../ZBAD', 'ZBAD?target=OTHER', 'ZBAD#fragment'])(
    'rejects malformed DDIC name %s before any SAP call',
    (name) => {
      const normalized = normalizeTypeArgsForValidation('SAPDiagnose', {
        action: 'atc',
        objects: [{ type: 'TABL/DS', name }],
      });
      expect(SAPDiagnoseSchema.safeParse(normalized).success).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );
});
