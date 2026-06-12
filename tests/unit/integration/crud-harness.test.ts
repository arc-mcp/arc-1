import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RUN_ID } from '../../helpers/run-id.js';
import {
  buildCreateXml,
  CrudRegistry,
  cleanupAll,
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
