import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestSpecification } from 'vitest/node';
import integration from '../../../vitest.integration.config.js';
import config, { ORDER_PROOF, OriginalTestOnly } from '../../../vitest.research-1057.config.js';
import { assertOriginalTestOnly, ORIGINAL_TEST } from '../../helpers/where-used-suite.js';

const mocks = vi.hoisted(() => ({ write: vi.fn(), mkdir: vi.fn() }));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  mkdirSync: mocks.mkdir,
  writeFileSync: mocks.write,
}));

beforeEach(() => vi.clearAllMocks());

describe('original-test-only research selection', () => {
  it('accepts only the original file and publishes a fresh one-file proof', async () => {
    const files = [{ moduleId: resolve(ORIGINAL_TEST) } as TestSpecification];
    assertOriginalTestOnly(files.map((file) => file.moduleId));
    expect(await new OriginalTestOnly({} as never).sort(files)).toBe(files);
    expect(mocks.write).toHaveBeenCalledWith(
      ORDER_PROOF,
      JSON.stringify({ fileCount: 1, targetRank: 1, predecessor: null }),
      { mode: 0o600 },
    );
  });
  it.each([
    { paths: [] },
    { paths: [resolve('tests/integration/other.test.ts')] },
    { paths: [resolve(ORIGINAL_TEST), resolve('tests/integration/mutation-lifecycle.integration.test.ts')] },
    { paths: [resolve(ORIGINAL_TEST), resolve(ORIGINAL_TEST)] },
    { paths: [ORIGINAL_TEST] },
  ])('rejects an invalid selection without publishing proof: $paths', async ({ paths }) => {
    expect(() => assertOriginalTestOnly(paths)).toThrow('expected only the original');
    const files = paths.map((moduleId) => ({ moduleId }) as TestSpecification);
    await expect(new OriginalTestOnly({} as never).sort(files)).rejects.toThrow('expected only the original');
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('preserves every integration setting except the explicit include and sequencer', () => {
    expect(config.test).toEqual({
      ...integration.test,
      include: [ORIGINAL_TEST],
      sequence: { ...integration.test?.sequence, sequencer: OriginalTestOnly },
    });
  });
});
