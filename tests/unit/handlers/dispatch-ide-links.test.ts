import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../src/server/logger.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const config = { ...DEFAULT_CONFIG, ideLinks: 'eclipse' as const, ideSystemId: 'DEV' };
const args = { type: 'PROG', name: 'ZHELLO', extensions: 'none' };

describe('native IDE links through the real dispatcher', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockResolvedValue(mockResponse(200, 'REPORT zhello.', { 'x-csrf-token': 'mock' }));
  });
  it('adds a separate link after a successful read with no additional SAP requests', async () => {
    const base = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', args);
    const baselineCalls = mockFetch.mock.calls.length;
    mockFetch.mockClear();
    const result = await handleToolCall(createClient(), config, 'SAPRead', args);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual(base.content[0]);
    expect(result.content.at(-1)?.text).toContain('adt://DEV/');
    expect(mockFetch).toHaveBeenCalledTimes(baselineCalls);
  });
  it('does not decorate a denied call or issue a SAP request', async () => {
    const result = await handleToolCall(createClient(), config, 'SAPRead', args, {
      token: 'test',
      clientId: 'test',
      scopes: [],
    });
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['object', 'tadir_lookup'])(
    'links the actual %s handler envelope without changing its JSON',
    async (searchType) => {
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<objectReferences><objectReference uri="/sap/bc/adt/oo/classes/zcl_test" type="CLAS/OC" name="ZCL_TEST" packageName="$TMP" description="Test"/></objectReferences>',
        ),
      );
      const searchArgs = { searchType, query: 'ZCL_TEST' };
      const baseline = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', searchArgs);
      const count = mockFetch.mock.calls.length;
      mockFetch.mockClear();
      const linked = await handleToolCall(createClient(), config, 'SAPSearch', searchArgs);
      expect(linked.isError).toBeUndefined();
      expect(linked.content[0]).toEqual(baseline.content[0]);
      expect(() => JSON.parse(linked.content[0].text)).not.toThrow();
      expect(linked.content[1].text).toContain('oo/classes/zcl_test');
      expect(mockFetch).toHaveBeenCalledTimes(count);
    },
  );
  it('links parsed ADT where-used identities while preserving evidence', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        200,
        `<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
        <usageReferences:referencedObjects>
          <usageReferences:referencedObject uri="/sap/bc/adt/oo/classes/zcl_caller" isResult="true">
            <usageReferences:adtObject adtcore:name="ZCL_CALLER" adtcore:type="CLAS/OC" xmlns:adtcore="http://www.sap.com/adt/core"/>
          </usageReferences:referencedObject>
        </usageReferences:referencedObjects>
      </usageReferences:usageReferenceResult>`,
      ),
    );
    const result = await handleToolCall(createClient(), config, 'SAPNavigate', {
      action: 'references',
      type: 'CLAS',
      name: 'ZCL_TARGET',
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).references[0].name).toBe('ZCL_CALLER');
    expect(result.content[1].text).toContain('oo/classes/zcl_caller');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
  it('does not duplicate links through the hyperfocused wrapper', async () => {
    const result = await handleToolCall(createClient(), { ...config, toolMode: 'hyperfocused' }, 'SAP', {
      action: 'read',
      params: args,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content.filter((item) => item.text.includes('adt://DEV/'))).toHaveLength(1);
  });
  it.each(['standard', 'hyperfocused'] as const)(
    'keeps HTTP presentation out of SAP requests and all %s audit previews',
    async (toolMode) => {
      const audit = vi.spyOn(logger, 'emitAudit').mockImplementation(() => {});
      try {
        const http = { ...config, transport: 'http-streamable' as const, toolMode };
        const name = toolMode === 'hyperfocused' ? 'SAP' : 'SAPRead';
        const input =
          toolMode === 'hyperfocused' ? { action: 'read', params: { ...args, include: null, action: '' } } : args;
        const result = await handleToolCall(
          createClient(),
          http,
          name,
          input,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { style: 'eclipse', systemId: 'DEV' },
        );
        expect(result.content).toHaveLength(2);
        expect(result.content[1].text).toContain('adt://DEV/');
        expect(JSON.stringify(audit.mock.calls)).not.toContain('adt://DEV/');
        expect(JSON.stringify(mockFetch.mock.calls)).not.toContain('adt://DEV/');
        const absent = await handleToolCall(createClient(), http, name, input);
        expect(absent.content).toHaveLength(1);
      } finally {
        audit.mockRestore();
      }
    },
  );
  it('does not decorate a successful result replaced by the target guard', async () => {
    const result = await handleToolCall(
      createClient(),
      config,
      'SAPRead',
      args,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => ({ isError: true, content: [{ type: 'text', text: 'Target changed' }] }),
    );
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'Target changed' }] });
  });
});
