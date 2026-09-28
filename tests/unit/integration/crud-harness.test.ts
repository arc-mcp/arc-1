import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtNetworkError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { defaultSafetyConfig, unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { RUN_ID } from '../../helpers/run-id.js';
import {
  buildCreateXml,
  CrudRegistry,
  cleanupAll,
  deleteObjectSet,
  generateUniqueName,
  retryDelete,
} from '../../integration/crud-harness.js';

describe('generateUniqueName', () => {
  it('produces uppercase names', () => {
    const name = generateUniqueName('ZARC1_IT');
    expect(name).toBe(name.toUpperCase());
  });

  it('produces names <= 30 characters', () => {
    const name = generateUniqueName('ZARC1_IT');
    expect(name.length).toBeLessThanOrEqual(30);
  });

  it('embeds the per-run id so concurrent runs do not collide', () => {
    const name = generateUniqueName('ZARC1_IT');
    expect(name).toContain(`_${RUN_ID}`);
  });

  it('produces different names on sequential calls even within the same millisecond', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const name1 = generateUniqueName('ZARC1_IT');
    // No time advance — same millisecond, counter ensures uniqueness
    const name2 = generateUniqueName('ZARC1_IT');
    vi.useRealTimers();
    expect(name1).toMatch(/^ZARC1_IT_[A-Z0-9]+$/);
    expect(name2).toMatch(/^ZARC1_IT_[A-Z0-9]+$/);
    expect(name1).not.toBe(name2);
  });

  it('throws if prefix is too long', () => {
    expect(() => generateUniqueName('ZARC1_THIS_PREFIX_IS_WAY_TOO_LONG')).toThrow('exceeds 30 characters');
  });
});

describe('CrudRegistry', () => {
  let registry: CrudRegistry;

  beforeEach(() => {
    registry = new CrudRegistry();
  });

  it('register adds entries', () => {
    registry.register('/url/1', 'PROG', 'ZPROG1');
    expect(registry.size).toBe(1);
  });

  it('getAll returns entries in reverse order', () => {
    registry.register('/url/1', 'PROG', 'ZPROG1');
    registry.register('/url/2', 'PROG', 'ZPROG2');
    registry.register('/url/3', 'CLAS', 'ZCL_3');
    const all = registry.getAll();
    expect(all.map((e) => e.name)).toEqual(['ZCL_3', 'ZPROG2', 'ZPROG1']);
  });

  it('remove removes by name', () => {
    registry.register('/url/1', 'PROG', 'ZPROG1');
    registry.register('/url/2', 'PROG', 'ZPROG2');
    registry.remove('ZPROG1');
    expect(registry.size).toBe(1);
    expect(registry.getAll()[0].name).toBe('ZPROG2');
  });

  it('size reflects current count', () => {
    expect(registry.size).toBe(0);
    registry.register('/url/1', 'PROG', 'ZPROG1');
    expect(registry.size).toBe(1);
    registry.register('/url/2', 'PROG', 'ZPROG2');
    expect(registry.size).toBe(2);
    registry.remove('ZPROG1');
    expect(registry.size).toBe(1);
  });
});

describe('retryDelete', () => {
  function mockHttp(behavior: Array<'success' | 'lock' | 'error'>) {
    let callIndex = 0;
    return {
      withStatefulSession: vi.fn(async (_fn: (session: unknown) => Promise<void>) => {
        const current = behavior[callIndex++] ?? 'error';
        if (current === 'success') {
          // Simulate successful lock + delete by calling fn with a mock session
          // But we need to mock lockObject/deleteObject at the module level
          // Instead, just resolve — the real test is that withStatefulSession is called
          return;
        }
        if (current === 'lock') {
          throw new Error('Object is locked by another user (enqueue conflict)');
        }
        throw new Error('Unexpected server error');
      }),
    };
  }

  it('succeeds on first attempt', async () => {
    const http = mockHttp(['success']);
    // We need to mock the crud module imports. Since retryDelete imports lockObject/deleteObject
    // internally via withStatefulSession, we mock at the http level.
    const result = await retryDelete(http as any, {} as any, '/sap/bc/adt/programs/programs/ztest', 3, 10);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('retries on lock conflict and succeeds', async () => {
    const http = mockHttp(['lock', 'success']);
    const result = await retryDelete(http as any, {} as any, '/sap/bc/adt/programs/programs/ztest', 3, 10);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('returns failure after max retries', async () => {
    const http = mockHttp(['lock', 'lock', 'lock']);
    const result = await retryDelete(http as any, {} as any, '/sap/bc/adt/programs/programs/ztest', 3, 10);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.lastError).toContain('enqueue');
  });

  it('fails immediately on non-lock errors', async () => {
    const http = mockHttp(['error']);
    const result = await retryDelete(http as any, {} as any, '/sap/bc/adt/programs/programs/ztest', 3, 10);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.lastError).toContain('Unexpected server error');
  });
});

describe('cleanupAll', () => {
  it('reports successes and failures', async () => {
    const registry = new CrudRegistry();
    registry.register('/url/1', 'PROG', 'ZPROG1');
    registry.register('/url/2', 'PROG', 'ZPROG2');

    let callCount = 0;
    const http = {
      withStatefulSession: vi.fn(async () => {
        callCount++;
        if (callCount <= 1) {
          // First call (ZPROG2, since reversed) succeeds
          return;
        }
        // Second call (ZPROG1) fails
        throw new Error('Unexpected server error');
      }),
    };

    const report = await cleanupAll(http as any, {} as any, registry);
    expect(report.cleaned).toBe(1);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].name).toBe('ZPROG1');
    expect(report.failed[0].error).toContain('Unexpected server error');
  });
});

describe('deleteObjectSet', () => {
  const pair = [
    { name: 'ZPAR', objectUrl: '/sap/bc/adt/ddic/ddl/sources/zpar' },
    { name: 'ZCHD', objectUrl: '/sap/bc/adt/ddic/ddl/sources/zchd' },
  ];
  const notFound = () => new AdtApiError('not found', 404, '/x');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports a safety denial without sending any requests', async () => {
    const http = {
      post: vi.fn().mockResolvedValue({ statusCode: 200, body: '' }),
      get: vi.fn().mockRejectedValue(notFound()),
      withStatefulSession: vi.fn(),
    };

    const failed = await deleteObjectSet(http as unknown as AdtHttpClient, defaultSafetyConfig(), pair);

    expect(failed).toEqual(pair.map(({ name }) => ({ name, error: expect.stringContaining('allowWrites=false') })));
    expect(console.error).toHaveBeenCalledWith('Object set cleanup failed:', failed);
    expect(http.post).not.toHaveBeenCalled();
    expect(http.get).not.toHaveBeenCalled();
    expect(http.withStatefulSession).not.toHaveBeenCalled();
  });

  it('deletes the whole set in one mass-deletion request', async () => {
    const http = {
      post: vi.fn(async (_path: string, _body: string) => ({ statusCode: 200, body: '' })),
      get: vi.fn(async () => {
        throw notFound();
      }),
      withStatefulSession: vi.fn(),
    };
    expect(await deleteObjectSet(http as any, unrestrictedSafetyConfig(), pair)).toEqual([]);
    expect(http.post).toHaveBeenCalledOnce();
    const [path, body] = http.post.mock.calls[0];
    expect(path).toBe('/sap/bc/adt/deletion/delete');
    expect(body).toContain('adtcore:uri="/sap/bc/adt/ddic/ddl/sources/zpar"');
    expect(body).toContain('adtcore:uri="/sap/bc/adt/ddic/ddl/sources/zchd"');
    expect(http.withStatefulSession).not.toHaveBeenCalled();
  });

  it('retries survivors one by one and reports what is still left', async () => {
    const http = {
      post: vi.fn(async () => {
        throw new Error('no mass deletion endpoint');
      }),
      // ZCHD was never created; ZPAR survives the failed set delete.
      get: vi.fn(async (url: string) => {
        if (url.endsWith('zchd')) throw notFound();
        return { statusCode: 200, body: '' };
      }),
      withStatefulSession: vi.fn(async () => {
        throw new Error('DDL source ZPAR could not be deleted');
      }),
    };
    const failed = await deleteObjectSet(http as any, unrestrictedSafetyConfig(), pair);
    expect(failed).toEqual([{ name: 'ZPAR', error: expect.stringContaining('could not be deleted') }]);
    expect(failed[0].error).toContain('no mass deletion endpoint');
    expect(http.withStatefulSession).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalled();
  });

  it('confirms absence after a failed verification read and fallback lock', async () => {
    const http = {
      post: vi.fn().mockResolvedValue({ statusCode: 200, body: '' }),
      get: vi
        .fn()
        .mockRejectedValueOnce(new AdtApiError('temporary backend failure', 500, pair[0].objectUrl))
        .mockRejectedValue(notFound()),
      withStatefulSession: vi.fn().mockRejectedValue(notFound()),
    };

    expect(await deleteObjectSet(http as unknown as AdtHttpClient, unrestrictedSafetyConfig(), pair)).toEqual([]);
    expect(http.withStatefulSession).toHaveBeenCalledOnce();
    expect(http.get.mock.calls.map(([url]) => url)).toEqual([pair[0].objectUrl, pair[0].objectUrl, pair[1].objectUrl]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'cleans up through the fallback when its delete response is lost: %s',
    async (loseResponse) => {
      let present = true;
      const session = {
        post: vi.fn().mockResolvedValue({ statusCode: 200, body: '<LOCK_HANDLE>H</LOCK_HANDLE>' }),
        delete: vi.fn(async () => {
          present = false;
          if (loseResponse) throw new AdtNetworkError('upstream disconnected');
          return { statusCode: 204, body: '' };
        }),
      };
      const http = {
        post: vi.fn().mockRejectedValue(new AdtApiError('endpoint absent', 404, '/sap/bc/adt/deletion/delete')),
        get: vi.fn(async () => {
          if (!present) throw notFound();
          return { statusCode: 200, body: '' };
        }),
        withStatefulSession: vi.fn(async (run: (client: AdtHttpClient) => Promise<void>) => {
          await run(session as unknown as AdtHttpClient);
        }),
      };

      expect(await deleteObjectSet(http as unknown as AdtHttpClient, unrestrictedSafetyConfig(), [pair[0]])).toEqual(
        [],
      );
      expect(session.delete).toHaveBeenCalledWith(`${pair[0].objectUrl}?lockHandle=H`);
      expect(present).toBe(false);
      expect(console.error).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['exists', undefined],
    ['forbidden', new AdtApiError('forbidden', 403, pair[0].objectUrl)],
    ['server error', new AdtApiError('server error', 500, pair[0].objectUrl)],
    ['network error', new AdtNetworkError('upstream disconnected')],
  ])('retains a fallback 404 failure when the final metadata probe reports %s', async (_label, probeError) => {
    const http = {
      post: vi.fn().mockResolvedValue({ statusCode: 200, body: '' }),
      get: vi
        .fn()
        .mockResolvedValueOnce({ statusCode: 200, body: '' })
        .mockImplementation(async () => {
          if (probeError) throw probeError;
          return { statusCode: 200, body: '' };
        }),
      // A DELETE/LOCK 404 alone does not establish absence (notably on SAP 7.50).
      withStatefulSession: vi.fn().mockRejectedValue(notFound()),
    };

    const failed = await deleteObjectSet(http as unknown as AdtHttpClient, unrestrictedSafetyConfig(), [pair[0]]);

    expect(failed).toEqual([{ name: pair[0].name, error: expect.stringContaining('status 404') }]);
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith('Object set cleanup failed:', failed);
  });
});

describe('buildCreateXml', () => {
  it('produces valid XML for PROG with correct name and package', () => {
    const xml = buildCreateXml('PROG', 'ZTEST_PROG', '$TMP', 'Test program');
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('adtcore:name="ZTEST_PROG"');
    expect(xml).toContain('adtcore:name="$TMP"');
    expect(xml).toContain('adtcore:description="Test program"');
    expect(xml).toContain('program:abapProgram');
  });

  it('produces valid XML for CLAS', () => {
    const xml = buildCreateXml('CLAS', 'ZCL_TEST', '$TMP', 'Test class');
    expect(xml).toContain('class:abapClass');
    expect(xml).toContain('adtcore:name="ZCL_TEST"');
  });

  it('escapes XML special characters in description', () => {
    const xml = buildCreateXml('PROG', 'ZTEST', '$TMP', 'Test & <demo>');
    expect(xml).toContain('adtcore:description="Test &amp; &lt;demo&gt;"');
  });

  it('produces fallback XML for unknown object types', () => {
    const xml = buildCreateXml('TABL', 'ZTABLE', '$TMP', 'Test');
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('adtcore:name="ZTABLE"');
  });
});
