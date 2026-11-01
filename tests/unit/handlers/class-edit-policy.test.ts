import { expect, it, vi } from 'vitest';
import { pinnedMutationContext, singleTargetMutationContext } from '../../../src/adt/mutation-context.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import type { SapWriteContext } from '../../../src/handlers/write/context.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { withClassEdit } = await import('../../../src/handlers/write/class-edit.js');

it.each(['legacy', 'pinned', 'missing'] as const)(
  'does not enter the legacy class lifecycle with pinned safety and %s context',
  async (mode) => {
    vi.resetAllMocks();
    const safety = {
      ...defaultSafetyConfig(),
      allowWrites: true,
      multiTargetWrite: {
        target: 'A4H/001',
        enabled: true,
        allowedPackages: ['$TMP'],
        allowedTransports: [],
        serverAllowedTransports: [],
      },
    };
    const client = new AdtClient({ baseUrl: 'http://sap:8000', safety });
    const mutationContext =
      mode === 'pinned'
        ? pinnedMutationContext(client.safety, { deadline: Date.now() + 1000 }, { unlockFailed: false })
        : mode === 'legacy'
          ? singleTargetMutationContext(defaultSafetyConfig())
          : undefined;
    const ctx = {
      client,
      mutationContext,
      objectUrl: '/sap/bc/adt/oo/classes/ztest',
      srcUrl: '/sap/bc/adt/oo/classes/ztest/source/main',
      name: 'ZTEST',
    } as unknown as SapWriteContext;
    const edit = vi.fn();
    await expect(withClassEdit(ctx, edit)).rejects.toThrow(
      mode === 'pinned' ? 'pinned source lifecycle' : 'mutation context',
    );
    expect(edit).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  },
);
