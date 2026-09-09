import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSourcePolicyError } from '../../../src/adt/data-source-policy.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const callers = [
  ['SAPNavigate', 'references', 'total', 'references'],
  ['SAPContext', 'usages', 'usageCount', 'usages'],
] as const;
const xml = (count = 2) =>
  `<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences" xmlns:adtcore="http://www.sap.com/adt/core">
    <usageReferences:referencedObjects>${Array.from(
      { length: count },
      (_, i) =>
        `<usageReferences:referencedObject uri="/sap/bc/adt/oo/classes/zcl_consumer/source/main#start=${i + 1},1" isResult="true">
        <usageReferences:adtObject adtcore:name="ZCL_CONSUMER" adtcore:type="CLAS/OC"/>
      </usageReferences:referencedObject>`,
    ).join('')}</usageReferences:referencedObjects>
  </usageReferences:usageReferenceResult>`;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
  mockFetch.mockResolvedValueOnce(mockResponse(200, xml()));
});
afterEach(() => vi.restoreAllMocks());

describe.each(callers)('%s %s output', (tool, action, countKey, resultsKey) => {
  it.each(['policy', 'transport'])(
    'preserves optional enrichment %s warnings without losing native entries',
    async (kind) => {
      const client = createClient();
      const failure =
        kind === 'policy'
          ? new DataSourcePolicyError('DATA_SOURCE_BLOCKED', 'SEOMETAREL', ['SEOMETAREL'], 'private diagnostic')
          : new Error('private transport diagnostic');
      const query = vi.spyOn(client, 'runQuery').mockRejectedValue(failure);
      const result = await handleToolCall(client, DEFAULT_CONFIG, tool, {
        action,
        type: 'INTF',
        name: 'ZIF_ROOT',
        maxResults: 1,
      });
      const output = JSON.parse(result.content[0]!.text!);
      expect(result.isError).toBeUndefined();
      expect(query).toHaveBeenCalledOnce();
      expect(output[countKey]).toBe(2);
      expect(output[resultsKey]).toHaveLength(1);
      expect(output).toMatchObject({ shown: 1, truncated: true });
      expect(output.warning).toMatch(/^Incomplete result:/);
      expect(output.warning).toContain('SEOMETAREL');
      expect(output.warning).toContain(`${tool}.${action}`);
      expect(output.warning).not.toContain('SAPWhereUsed');
      expect(output.warning).toContain('may be incomplete');
      expect(output.warning).not.toContain('private');
      expect(output.countMeaning).toContain('not distinct objects or runtime calls');
    },
  );

  it('counts multiple entries from the same class without claiming distinct consumers', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, tool, {
      action,
      type: 'CLAS',
      name: 'ZCL_ROOT',
    });
    const output = JSON.parse(result.content[0]!.text!);
    expect(output[countKey]).toBe(2);
    expect(output[resultsKey].map((row: { name: string }) => row.name)).toEqual(['ZCL_CONSUMER', 'ZCL_CONSUMER']);
    expect(output.countMeaning).toContain('Reference entries');
    expect(output.countMeaning).toContain('not a complete inventory');
    expect(output.warning).toBeUndefined();
  });

  it('does not let a zero-count page imply a complete inventory', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
    mockFetch.mockResolvedValueOnce(mockResponse(200, xml(0)));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, tool, {
      action,
      type: 'CLAS',
      name: 'ZCL_ROOT',
    });
    const output = JSON.parse(result.content[0]!.text!);
    expect(output[countKey]).toBe(0);
    expect(output[resultsKey]).toEqual([]);
    expect(output.truncated).toBe(false);
    expect(output.countMeaning).toContain('not a complete inventory');
  });
});
