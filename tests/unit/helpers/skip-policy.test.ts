import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TaskContext } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireOrSkip, skipTest } from '../../helpers/skip-policy.js';

const originalSkipReasonsFile = process.env.ARC1_SKIP_REASONS_FILE;
let tempDir: string | undefined;

/** Create a mock TaskContext with a spy on skip that throws (like real Vitest). */
function mockCtx(): TaskContext {
  return {
    skip: vi.fn(() => {
      throw new Error('VITEST_SKIP');
    }),
  } as unknown as TaskContext;
}

function mockCtxWithTask(file: string): TaskContext {
  return {
    ...mockCtx(),
    task: {
      name: 'skips for a known backend gap',
      fullName: `${file} > live suite > skips for a known backend gap`,
      file: { filepath: file },
    },
  } as unknown as TaskContext;
}

describe('skip-policy', () => {
  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    if (originalSkipReasonsFile === undefined) {
      delete process.env.ARC1_SKIP_REASONS_FILE;
    } else {
      process.env.ARC1_SKIP_REASONS_FILE = originalSkipReasonsFile;
    }
  });

  describe('requireOrSkip', () => {
    it('does not skip when value is a non-empty string', () => {
      const ctx = mockCtx();
      const value: string | null = 'ZDDLS_TEST';
      requireOrSkip(ctx, value, 'No DDLS');
      expect(ctx.skip).not.toHaveBeenCalled();
    });

    it('skips when value is null', () => {
      const ctx = mockCtx();
      expect(() => requireOrSkip(ctx, null, 'No DDLS candidate found')).toThrow();
      expect(ctx.skip).toHaveBeenCalledWith('No DDLS candidate found');
    });

    it('skips when value is undefined', () => {
      const ctx = mockCtx();
      expect(() => requireOrSkip(ctx, undefined, 'No DDLS source available')).toThrow();
      expect(ctx.skip).toHaveBeenCalledWith('No DDLS source available');
    });

    it('does not skip when value is 0 (falsy but defined)', () => {
      const ctx = mockCtx();
      requireOrSkip(ctx, 0, 'Should not skip');
      expect(ctx.skip).not.toHaveBeenCalled();
    });

    it('does not skip when value is false (falsy but defined)', () => {
      const ctx = mockCtx();
      requireOrSkip(ctx, false, 'Should not skip');
      expect(ctx.skip).not.toHaveBeenCalled();
    });

    it('does not skip when value is empty string (falsy but defined)', () => {
      const ctx = mockCtx();
      requireOrSkip(ctx, '', 'Should not skip');
      expect(ctx.skip).not.toHaveBeenCalled();
    });

    it('narrows type after successful check', () => {
      const ctx = mockCtx();
      const value: string | null = 'ZDDLS_TEST';
      requireOrSkip(ctx, value, 'No DDLS');
      // After requireOrSkip, TypeScript treats value as string (non-null).
      // This assignment would fail to compile if type narrowing didn't work.
      const narrowed: string = value;
      expect(narrowed).toBe('ZDDLS_TEST');
    });

    it('skips with empty string reason', () => {
      const ctx = mockCtx();
      expect(() => requireOrSkip(ctx, null, '')).toThrow();
      expect(ctx.skip).toHaveBeenCalledWith('');
    });
  });

  describe('skipTest telemetry', () => {
    it('writes structured skip telemetry when Vitest task metadata is present', () => {
      tempDir = mkdtempSync(join(tmpdir(), 'arc1-skip-policy-'));
      const telemetryFile = join(tempDir, 'skips.ndjson');
      process.env.ARC1_SKIP_REASONS_FILE = telemetryFile;

      const ctx = mockCtxWithTask('/repo/tests/e2e/smoke.e2e.test.ts');
      expect(() => skipTest(ctx, 'Backend feature not supported on this SAP system')).toThrow();

      const records = readFileSync(telemetryFile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        suite: 'e2e',
        reason: 'Backend feature not supported on this SAP system',
        test: 'skips for a known backend gap',
        file: '/repo/tests/e2e/smoke.e2e.test.ts',
      });
    });
  });
});
