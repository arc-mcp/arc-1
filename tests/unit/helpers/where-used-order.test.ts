import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestSpecification } from 'vitest/node';
import integration from '../../../vitest.integration.config.js';
import config, { ORDER_PROOF, OriginalIntegrationOrder } from '../../../vitest.research-1057.config.js';

const mocks = vi.hoisted(() => ({ sizes: new Map<string, number>(), write: vi.fn(), mkdir: vi.fn() }));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  statSync: (path: string) => ({ size: mocks.sizes.get(path) ?? 0 }),
  mkdirSync: mocks.mkdir,
  writeFileSync: mocks.write,
}));

function specifications(): TestSpecification[] {
  const entries = [
    ...Array.from({ length: 25 }, (_, i) => [`tests/integration/large-${i}.test.ts`, 5000] as const),
    ['tests/integration/mutation-lifecycle.integration.test.ts', 4200] as const,
    ['tests/integration/where-used-details.integration.test.ts', 7000] as const,
    ...Array.from({ length: 8 }, (_, i) => [`tests/integration/small-${i}.test.ts`, 1000] as const),
  ];
  return entries.map(([path, size]) => {
    mocks.sizes.set(resolve(path), size);
    return { moduleId: resolve(path) } as TestSpecification;
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.sizes.clear();
});

describe('frozen integration order for research', () => {
  it('restores the original predecessor/rank despite instrumentation and writes fixed proof', async () => {
    const files = specifications();
    const order = await new OriginalIntegrationOrder({} as never).sort(files);
    expect(order[25]?.moduleId).toBe(resolve('tests/integration/mutation-lifecycle.integration.test.ts'));
    expect(order[26]?.moduleId).toBe(resolve('tests/integration/where-used-details.integration.test.ts'));
    expect(mocks.write).toHaveBeenCalledWith(
      ORDER_PROOF,
      JSON.stringify({
        fileCount: 35,
        targetRank: 27,
        predecessor: 'tests/integration/mutation-lifecycle.integration.test.ts',
      }),
      { mode: 0o600 },
    );
  });
  it('refuses a missing target, changed inventory or wrong predecessor before publishing proof', async () => {
    const order = new OriginalIntegrationOrder({} as never);
    const missing = specifications();
    missing[26] = { moduleId: resolve('tests/integration/other.test.ts') } as TestSpecification;
    await expect(order.sort(missing)).rejects.toThrow('frozen integration order');
    await expect(order.sort(specifications().slice(0, -1))).rejects.toThrow('frozen integration order');
    const predecessor = specifications();
    predecessor[25] = { moduleId: resolve('tests/integration/different.test.ts') } as TestSpecification;
    mocks.sizes.set(predecessor[25]!.moduleId, 4200);
    await expect(order.sort(predecessor)).rejects.toThrow('frozen integration order');
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('preserves the original include, exclusion, hooks and sequential settings', () => {
    expect(config.test).toEqual({
      ...integration.test,
      sequence: { ...integration.test?.sequence, sequencer: OriginalIntegrationOrder },
    });
  });
});
