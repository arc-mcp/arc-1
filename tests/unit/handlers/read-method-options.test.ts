import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { handleSAPRead } = await import('../../../src/handlers/read.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { SAPReadSchema, SAPReadSchemaBtp } = await import('../../../src/handlers/schemas.js');

const SOURCE = `CLASS zcl_demo DEFINITION PUBLIC.
PUBLIC SECTION.
CLASS-METHODS create IMPORTING url TYPE string RETURNING VALUE(result) TYPE REF TO zcl_demo.
ENDCLASS.
CLASS zcl_demo IMPLEMENTATION.
METHOD create.
  result = NEW #( ).
ENDMETHOD.
ENDCLASS.`;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  resetCachedFeatures();
});

describe.each(['standard', 'hyperfocused'] as const)('method read options via %s', (toolMode) => {
  function read(options: Record<string, unknown>) {
    const args = { type: 'CLAS', name: 'ZCL_DEMO', ...options };
    return handleToolCall(
      createClient(),
      { ...DEFAULT_CONFIG, toolMode },
      toolMode === 'standard' ? 'SAPRead' : 'SAP',
      toolMode === 'standard' ? args : { action: 'read', params: args },
    );
  }

  it.each(['create', '*'])('rejects structured + method=%s before even resolving drafts', async (method) => {
    const result = await read({ method, format: 'structured', version: 'auto' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Do not combine method with format="structured"');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    { method: '*' },
    { method: '' },
    { method: 'lcl_helper~create' },
    { method: 'if_http_client~send' },
    { include: 'definitions' },
    { include: 'implementations' },
    { include: 'testclasses' },
    { include: 'text_symbols' },
    { include: 'macros' },
    { type: 'INTF' },
    { type: 'PROG' },
    { grep: 'create' },
    { lineStart: 1, lineEnd: 5 },
    { action: 'diff' },
    { format: 'editable' },
    { format: 'structured' },
    { includeSignature: true },
    { expand_includes: true },
    { methodView: 'unknown' },
  ])('rejects incompatible signature options with no SAP requests: %j', async (options) => {
    const result = await read({ method: 'create', methodView: 'signature', ...options });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('requires a method for a signature read', async () => {
    expect((await read({ methodView: 'signature' })).isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns the own declaration through the ordinary main-source endpoint', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, SOURCE, { 'x-csrf-token': 't' }));
    const result = await read({ method: 'create', methodView: 'signature', include: 'MAIN' });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text!);
    expect(payload).toMatchObject({
      className: 'ZCL_DEMO',
      scope: 'own-declaration',
      methodName: 'create',
      signature: 'CLASS-METHODS create IMPORTING url TYPE string RETURNING VALUE(result) TYPE REF TO zcl_demo.',
    });
    expect(result.content[0]?.text).not.toContain('NEW');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0]![0])).toContain('/classes/ZCL_DEMO/source/main');
  });

  it('keeps existing method bodies, method inventory and whole-source text reads', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, SOURCE, { 'x-csrf-token': 't' }));
    expect((await read({ method: 'create' })).content[0]?.text).toBe(
      'METHOD create.\n  result = NEW #( ).\nENDMETHOD.',
    );
    expect((await read({ method: '*' })).content[0]?.text).toContain('IMPORTING');
    expect((await read({})).content[0]?.text).toBe(SOURCE);
  });

  it('keeps grep with structured format on its existing focused branch', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, SOURCE, { 'x-csrf-token': 't' }));
    const result = await read({ grep: 'NEW', format: 'structured' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('match(es)');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('shared validation and source version', () => {
  it.each([SAPReadSchema, SAPReadSchemaBtp])('keeps both runtime schemas aligned', (schema) => {
    expect(
      schema.safeParse({ type: 'CLAS', name: 'ZCL_DEMO', method: 'create', methodView: 'signature' }).success,
    ).toBe(true);
    expect(schema.safeParse({ type: 'CLAS', method: '*', format: 'structured' }).success).toBe(false);
    expect(schema.safeParse({ type: 'CLAS', format: 'structured' }).success).toBe(true);
    expect(schema.safeParse({ type: 'INTF', method: 'create', methodView: 'signature' }).success).toBe(false);
  });

  it('guards direct handler calls before SAP requests', async () => {
    const result = await handleSAPRead(
      createClient(),
      { type: 'CLAS', name: 'ZCL_DEMO', method: 'create', format: 'structured' },
      undefined,
      { isPerUserClient: false },
      false,
    );
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(['active', 'inactive', 'auto'] as const)('preserves version=%s resolution', async (version) => {
    const client = createClient();
    vi.spyOn(client, 'getInactiveObjects').mockResolvedValue([
      { name: 'ZCL_DEMO', type: 'CLAS/OC', uri: '/sap/bc/adt/oo/classes/zcl_demo' },
    ]);
    const getClass = vi
      .spyOn(client, 'getClass')
      .mockResolvedValue({ source: SOURCE, notModified: false, statusCode: 200 });
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
      type: 'CLAS',
      name: 'ZCL_DEMO',
      method: 'create',
      methodView: 'signature',
      version,
    });
    expect(result.isError).toBeUndefined();
    expect(getClass).toHaveBeenCalledWith(
      'ZCL_DEMO',
      undefined,
      expect.objectContaining({ version: version === 'auto' ? 'inactive' : version }),
    );
  });

  it('preserves the inactive fallback warning alongside a signature', async () => {
    const client = createClient();
    vi.spyOn(client, 'getInactiveObjects').mockResolvedValue([]);
    vi.spyOn(client, 'getClass').mockResolvedValue({ source: SOURCE, notModified: false, statusCode: 200 });
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
      type: 'CLAS',
      name: 'ZCL_DEMO',
      method: 'create',
      methodView: 'signature',
      version: 'inactive',
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text!).warning).toContain('No inactive draft exists');
    expect(result.content[0]?.text).toContain('CLASS-METHODS create');
  });
});
