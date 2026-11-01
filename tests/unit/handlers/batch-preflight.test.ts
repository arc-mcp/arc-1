import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtSafetyError } from '../../../src/adt/errors.js';
import type { CachingLayer } from '../../../src/cache/caching-layer.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { SAPWriteSchema, SAPWriteSchemaBtp } = await import('../../../src/handlers/schemas.js');
const transportModule = await import('../../../src/adt/transport.js');
const writeHelpers = await import('../../../src/handlers/write-helpers.js');
const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
const program = (name: string) => ({ type: 'PROG', name, source: `REPORT ${name.toLowerCase()}.` });
const ok = () => mockResponse(200, '<asx:values><LOCK_HANDLE>LH</LOCK_HANDLE></asx:values>', { 'x-csrf-token': 'T' });

function creates() {
  return mockFetch.mock.calls.filter(
    ([url, options]) => options?.method === 'POST' && new URL(String(url)).pathname === '/sap/bc/adt/programs/programs',
  );
}

function run(
  objects: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
  cache?: CachingLayer,
  overrides: Partial<ServerConfig> = {},
) {
  return handleToolCall(
    createClient(),
    { ...config, ...overrides },
    'SAPWrite',
    {
      action: 'batch_create',
      package: '$TMP',
      objects,
      ...extra,
    },
    undefined,
    undefined,
    cache,
  );
}

describe('batch preflight and persisted outcomes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    resetCachedFeatures();
    mockFetch.mockImplementation(() => Promise.resolve(ok()));
  });

  it.each([
    ['mixed-case name', { type: 'PROG', name: 'Zbad' }],
    ['function-group structural include', { type: 'INCL', name: 'LZGROUPTOP' }],
    ['unsupported SDO', { type: 'UIAD', name: 'ZBAD' }],
    ['invalid AFF header', { type: 'PROG', name: 'ZBAD', description: 'x'.repeat(100) }],
    ['duplicate entry', program('ZFIRST')],
  ])('rejects a later %s before creating the first object', async (_label, invalid) => {
    const result = await run([program('ZFIRST'), invalid]);
    expect(result.isError).toBe(true);
    expect(creates()).toHaveLength(0);
    expect(mockFetch.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
    expect(result.content[0].text).toContain('preflight');
  });

  it('retains schema rejection of an empty name before mutation', async () => {
    const result = await run([program('ZFIRST'), { type: 'PROG', name: ' ' }]);
    expect(result.isError).toBe(true);
    expect(creates()).toHaveLength(0);
    expect(result.content[0].text).toContain('objects.1.name');
  });

  it.each(['create', 'batch_create'])('%s skips CTS checks for every local $ package', async (action) => {
    const probe = vi.spyOn(transportModule, 'getTransportInfo').mockRejectedValue(new Error('Must not be called'));
    const result = await handleToolCall(createClient(), config, 'SAPWrite', {
      action,
      package: '$ZLOCAL',
      ...(action === 'create' ? program('ZFIRST') : { objects: [program('ZFIRST')] }),
    });
    expect(result.isError).toBeFalsy();
    expect(probe).not.toHaveBeenCalled();
    expect(creates()).toHaveLength(1);
  });

  it.each(['create', 'batch_create'])(
    '%s fails closed on transport authorization and safety refusals',
    async (action) => {
      for (const status of [401, 403]) {
        mockFetch.mockImplementation((url) =>
          Promise.resolve(
            new URL(String(url)).pathname.includes('/cts/transportchecks')
              ? mockResponse(status, 'PRIVATE_TRANSPORT_DETAIL', { 'x-csrf-token': 'T' })
              : ok(),
          ),
        );
        const result = await handleToolCall(createClient(), { ...config, minimalErrors: true }, 'SAPWrite', {
          action,
          package: 'ZTRANSPORTED',
          ...(action === 'create' ? program('ZFIRST') : { objects: [program('ZFIRST')] }),
        });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).not.toContain('PRIVATE_TRANSPORT_DETAIL');
        expect(creates()).toHaveLength(0);
        if (action === 'batch_create')
          expect(JSON.parse(result.content[1].text).batch).toMatchObject({ phase: 'preflight', created: 0 });
      }
      vi.spyOn(transportModule, 'getTransportInfo').mockRejectedValue(new AdtSafetyError('Transport check denied'));
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action,
        package: 'ZTRANSPORTED',
        ...(action === 'create' ? program('ZFIRST') : { objects: [program('ZFIRST')] }),
      });
      expect(result.isError).toBe(true);
      expect(creates()).toHaveLength(0);
    },
  );

  it('reports global activation messages once, outside per-object diagnostics', async () => {
    mockFetch.mockImplementation((url, options) =>
      Promise.resolve(
        options?.method === 'POST' && new URL(String(url)).pathname === '/sap/bc/adt/activation'
          ? mockResponse(
              200,
              '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><msg type="E" severity="error" shortText="Activation was cancelled."/></chkl:messages>',
              { 'x-csrf-token': 'T' },
            )
          : ok(),
      ),
    );
    const result = await run([program('ZFIRST'), program('ZSECOND')], { activateAtEnd: true });
    expect(result.content[0].text.match(/Activation was cancelled\./g)).toHaveLength(1);
    const { batch } = JSON.parse(result.content[1].text);
    expect(batch.results.every((entry: { error: string }) => !entry.error.includes('Activation was cancelled.'))).toBe(
      true,
    );
  });

  it('caps large human diagnostics while retaining all manifest entries', async () => {
    vi.spyOn(writeHelpers, 'buildCreateXml').mockImplementation(() => {
      throw new Error('x'.repeat(4000));
    });
    const result = await run(Array.from({ length: 100 }, (_, index) => program(`ZFAIL${index}`)));
    expect(result.content[0].text.length).toBeLessThan(8000);
    expect(result.content[0].text).toContain('summary truncated');
    const { batch } = JSON.parse(result.content[1].text);
    expect(batch.results).toHaveLength(100);
    expect(batch.failed).toBe(100);
    expect(batch.results[99].error.length).toBeLessThan(2100);
  });

  it('checks enabled source lint across the entire batch before creating', async () => {
    const result = await handleToolCall(createClient(), { ...config, lintBeforeWrite: true }, 'SAPWrite', {
      action: 'batch_create',
      package: '$TMP',
      objects: [program('ZFIRST'), { type: 'PROG', name: 'ZBAD', source: 'REPORT zbad. DATA lv TYPE.' }],
    });
    expect(result.isError).toBe(true);
    expect(creates()).toHaveLength(0);
  });

  it('reports all predictable bad entries together', async () => {
    const result = await run([program('ZFIRST'), { type: 'PROG', name: 'Zbad' }, { type: 'UIAD', name: 'ZUIAD' }]);
    expect(result.content[0].text).toContain('Zbad');
    expect(result.content[0].text).toContain('ZUIAD');
    expect(creates()).toHaveLength(0);
    const { batch } = JSON.parse(result.content[1].text);
    expect(batch.failed).toBe(2);
    expect(batch.results[1].error).toContain('uppercase');
    expect(batch.results[1].error).toContain('ZBAD');
    expect(batch.results[2].error).toContain('does not support');
  });

  it.each([
    [
      { type: 'TABL', name: 'ZTABLE' },
      { type: 'TABL/DS', name: 'ZTABLE' },
    ],
    [
      { type: 'PROG', name: 'ZCODE' },
      { type: 'INCL', name: 'ZCODE' },
    ],
    [
      { type: 'FUNC', name: 'ZFUNC', group: 'ZGROUP1' },
      { type: 'FUNC', name: 'ZFUNC', group: 'ZGROUP2' },
    ],
    [
      { type: 'CLAS', name: 'ZSAME' },
      { type: 'INTF', name: 'ZSAME' },
    ],
    [
      { type: 'INTF', name: 'ZSAME' },
      { type: 'CLAS', name: 'ZSAME' },
    ],
  ])('rejects duplicate repository identities across aliases/containers', async (first, second) => {
    const result = await run([first, second]);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Duplicate object');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows distinct DDLS and BDEF objects sharing a name', async () => {
    const result = await run([
      { type: 'DDLS', name: 'ZSAME' },
      { type: 'BDEF', name: 'ZSAME' },
    ]);
    expect(result.isError).toBeUndefined();
  });

  it.each([false, true])('constructs all metadata bodies before mutation (minimalErrors=%s)', async (minimalErrors) => {
    const original = writeHelpers.buildCreateXml;
    vi.spyOn(writeHelpers, 'buildCreateXml').mockImplementation((...args) => {
      if (args[1] === 'ZSECOND') throw new Error('Invalid metadata shape');
      return original(...args);
    });
    const result = await run([program('ZFIRST'), program('ZSECOND')], {}, undefined, { minimalErrors });
    expect(result.content[0].text).toContain('Invalid metadata shape');
    expect(creates()).toHaveLength(0);
  });

  it('rejects a later MSAG transport lookup failure before creating the first object', async () => {
    mockFetch.mockImplementation((url) => {
      if (new URL(String(url)).pathname.includes('/cts/transportrequests/')) {
        return Promise.resolve(mockResponse(403, 'PRIVATE_TRANSPORT_OWNER', { 'x-csrf-token': 'T' }));
      }
      return Promise.resolve(ok());
    });
    const result = await run(
      [program('ZFIRST'), { type: 'MSAG', name: 'ZMESSAGES', transport: 'A4HK900001' }],
      {},
      undefined,
      { minimalErrors: true },
    );
    expect(result.isError).toBe(true);
    expect(creates()).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TRANSPORT_OWNER');
    expect(JSON.parse(result.content[1].text).batch.phase).toBe('preflight');
  });

  it.each([0, 1, 2])('preserves exact confirmed/skipped counts when create %i fails', async (index) => {
    const objects = [program('ZFIRST'), program('ZSECOND'), program('ZTHIRD')];
    mockFetch.mockImplementation((url, options) => {
      if (
        options?.method === 'POST' &&
        new URL(String(url)).pathname === '/sap/bc/adt/programs/programs' &&
        String(options.body).includes(objects[index].name)
      ) {
        return Promise.resolve(mockResponse(500, 'create failed', { 'x-csrf-token': 'T' }));
      }
      return Promise.resolve(ok());
    });
    const result = await run(objects);
    const { batch } = JSON.parse(result.content[1].text);
    expect(batch).toMatchObject({
      created: index,
      completed: index,
      creationUnknown: 1,
      failed: 1,
      skipped: 2 - index,
    });
    expect(creates()).toHaveLength(index + 1);
  });

  it('keeps invalidation scoped to the propagated user on a failed write', async () => {
    mockFetch.mockImplementation((_url, options) =>
      options?.method === 'PUT'
        ? Promise.resolve(mockResponse(500, 'failed', { 'x-csrf-token': 'T' }))
        : Promise.resolve(ok()),
    );
    const cache = { invalidate: vi.fn(), inactiveLists: { invalidate: vi.fn() } } as unknown as CachingLayer;
    const auth = { token: 'test', clientId: 'client', scopes: ['write'], extra: { userName: 'ALICE' } };
    const result = await handleToolCall(
      createClient(),
      config,
      'SAPWrite',
      {
        action: 'batch_create',
        package: '$TMP',
        objects: [program('ZFIRST')],
      },
      auth,
      undefined,
      cache,
      true,
    );
    expect(result.isError).toBe(true);
    expect(cache.inactiveLists.invalidate).toHaveBeenCalledWith('client:userName:ALICE');
    expect(cache.inactiveLists.invalidate).not.toHaveBeenCalledWith('admin');
  });

  it('bounds both runtime schemas and dispatch to 100 entries', async () => {
    const objects = Array.from({ length: 101 }, (_, index) => ({ type: 'INTF', name: `ZIF_BOUND_${index}` }));
    for (const schema of [SAPWriteSchema, SAPWriteSchemaBtp]) {
      expect(schema.safeParse({ action: 'batch_create', objects }).success).toBe(false);
      expect(schema.safeParse({ action: 'batch_create', objects: objects.slice(0, 100) }).success).toBe(true);
    }
    expect((await run(objects)).isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('retains confirmed creation and marks an uncertain create separately from skipped entries', async () => {
    mockFetch.mockImplementation((url, options) => {
      if (
        options?.method === 'POST' &&
        new URL(String(url)).pathname === '/sap/bc/adt/programs/programs' &&
        String(options.body).includes('ZSECOND')
      ) {
        return Promise.resolve(mockResponse(500, 'Program already exists', { 'x-csrf-token': 'T' }));
      }
      return Promise.resolve(ok());
    });
    const result = await run([program('ZFIRST'), program('ZSECOND'), program('ZTHIRD')]);
    const { batch } = JSON.parse(result.content[1].text);
    expect(batch).toMatchObject({ created: 1, creationUnknown: 1, completed: 1, failed: 1, skipped: 1 });
    expect(batch.results[1]).toMatchObject({ creation: 'unknown', write: 'not_attempted', failedPhase: 'create' });
    expect(batch.results[2]).toMatchObject({ creation: 'not_attempted', status: 'skipped' });
    expect(creates()).toHaveLength(2);
  });

  it.each(['PROG', 'TTYP'])(
    'keeps a %s shell after PUT failure and hides wrapped SAP details in both blocks',
    async (type) => {
      mockFetch.mockImplementation((_url, options) => {
        if (options?.method === 'PUT')
          return Promise.resolve(mockResponse(500, 'PRIVATE_SAP_DETAIL', { 'x-csrf-token': 'T' }));
        return Promise.resolve(ok());
      });
      const first =
        type === 'PROG'
          ? program('ZFIRST')
          : { type: 'TTYP', name: 'ZFIRST', rowType: 'SFLIGHT', rowTypeKind: 'structure' };
      const result = await run([first, program('ZSECOND')], {}, undefined, { minimalErrors: true });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_SAP_DETAIL');
      expect(result.content[0].text).toContain('ARC1_MINIMAL_ERRORS');
      const { batch } = JSON.parse(result.content[1].text);
      expect(batch.results[0]).toMatchObject({
        creation: 'confirmed',
        write: 'unknown',
        activation: 'not_attempted',
        failedPhase: 'write',
      });
    },
  );

  it('does not report success after an unassigned terminal activation error', async () => {
    mockFetch.mockImplementation((url, options) => {
      if (options?.method === 'POST' && new URL(String(url)).pathname === '/sap/bc/adt/activation') {
        return Promise.resolve(
          mockResponse(
            200,
            '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><msg type="E" severity="error" shortText="PRIVATE_UNASSIGNED_ERROR"/></chkl:messages>',
            { 'x-csrf-token': 'T' },
          ),
        );
      }
      return Promise.resolve(ok());
    });
    const result = await run([program('ZFIRST'), program('ZSECOND')], { activateAtEnd: true }, undefined, {
      minimalErrors: true,
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_UNASSIGNED_ERROR');
    const { batch } = JSON.parse(result.content[1].text);
    expect(batch.completed).toBe(0);
    expect(batch.results.every((entry: { activation: string }) => entry.activation === 'unknown')).toBe(true);
  });

  it('matches activation error URIs at object boundaries and leaves unreported objects unknown', async () => {
    mockFetch.mockImplementation((url, options) => {
      if (options?.method === 'POST' && new URL(String(url)).pathname === '/sap/bc/adt/activation') {
        return Promise.resolve(
          mockResponse(
            200,
            '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><msg type="E" severity="error" shortText="Specific failure" uri="/sap/bc/adt/programs/programs/ZFIRST2/source/main#start=1,1"/></chkl:messages>',
            { 'x-csrf-token': 'T' },
          ),
        );
      }
      return Promise.resolve(ok());
    });
    const result = await run([program('ZFIRST'), program('ZFIRST2')], { activateAtEnd: true });
    const { batch } = JSON.parse(result.content[1].text);
    expect(batch.results[0].activation).toBe('unknown');
    expect(batch.results[0].error).not.toContain('Specific failure');
    expect(batch.results[0].error).toContain('without an object-specific error');
    expect(batch.results[1].error).toContain('Specific failure');
    expect(batch.results[1].activation).toBe('failed');
  });

  it('preserves deferred activation of only the successfully written subset', async () => {
    let activated = '';
    mockFetch.mockImplementation((url, options) => {
      const path = new URL(String(url)).pathname;
      if (options?.method === 'PUT' && path.includes('ZSECOND'))
        return Promise.resolve(mockResponse(500, 'write failed', { 'x-csrf-token': 'T' }));
      if (options?.method === 'POST' && path === '/sap/bc/adt/activation') activated = String(options.body);
      return Promise.resolve(ok());
    });
    const result = await run([program('ZFIRST'), program('ZSECOND'), program('ZTHIRD')], { activateAtEnd: true });
    expect(activated).toContain('ZFIRST');
    expect(activated).not.toContain('ZSECOND');
    const { batch } = JSON.parse(result.content[1].text);
    expect(batch.results[0]).toMatchObject({ status: 'success', activation: 'confirmed' });
    expect(batch.results[1]).toMatchObject({ creation: 'confirmed', activation: 'not_attempted' });
    expect(batch.results[2].status).toBe('skipped');
  });

  it('invalidates canonical TABL cache entries after failed activation', async () => {
    mockFetch.mockImplementation((url, options) => {
      if (options?.method === 'POST' && new URL(String(url)).pathname === '/sap/bc/adt/activation')
        return Promise.resolve(mockResponse(500, 'failed', { 'x-csrf-token': 'T' }));
      return Promise.resolve(ok());
    });
    const cache = { invalidate: vi.fn(), inactiveLists: { invalidate: vi.fn() } } as unknown as CachingLayer;
    await run([{ type: 'TABL/DS', name: 'ZSTRUCT' }], {}, cache);
    expect(cache.invalidate).toHaveBeenCalledWith('TABL', 'ZSTRUCT', 'all');
  });

  it('reports a created draft when its activation fails and invalidates its cache', async () => {
    mockFetch.mockImplementation((url, options) => {
      if (options?.method === 'POST' && new URL(String(url)).pathname === '/sap/bc/adt/activation') {
        return Promise.resolve(
          mockResponse(
            200,
            '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><msg type="E" severity="error" shortText="Unknown type"/></chkl:messages>',
            { 'x-csrf-token': 'T' },
          ),
        );
      }
      return Promise.resolve(ok());
    });
    const cache = { invalidate: vi.fn(), inactiveLists: { invalidate: vi.fn() } } as unknown as CachingLayer;
    const result = await run([program('ZFIRST'), program('ZSECOND')], {}, cache);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('created 1/2');
    expect(result.content[0].text).toContain('remain');
    const { batch } = JSON.parse(result.content[1].text);
    expect(batch.results[0]).toMatchObject({ creation: 'confirmed', write: 'confirmed', activation: 'failed' });
    expect(batch.results[1]).toMatchObject({ status: 'skipped', creation: 'not_attempted' });
    expect(cache.invalidate).toHaveBeenCalledWith('PROG', 'ZFIRST', 'all');
    expect(cache.inactiveLists.invalidate).toHaveBeenCalled();
  });

  it('preserves both created objects after a terminal activation transport error', async () => {
    mockFetch.mockImplementation((url, options) => {
      if (options?.method === 'POST' && new URL(String(url)).pathname === '/sap/bc/adt/activation') {
        return Promise.resolve(mockResponse(500, 'Backend publication-free test failure', { 'x-csrf-token': 'T' }));
      }
      return Promise.resolve(ok());
    });
    const result = await run([program('ZFIRST'), program('ZSECOND')], { activateAtEnd: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('created 2/2');
    const { batch } = JSON.parse(result.content[1].text);
    expect(batch.results).toHaveLength(2);
    for (const entry of batch.results) {
      expect(entry).toMatchObject({
        creation: 'confirmed',
        write: 'confirmed',
        activation: 'unknown',
        failedPhase: 'activate',
      });
    }
  });

  it('keeps successful batches in their existing single text block', async () => {
    const result = await run([program('ZFIRST'), program('ZSECOND')]);
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toContain('Batch created 2 objects');
  });
});
