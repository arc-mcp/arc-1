import { expect, it } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { createPinnedPackageHierarchyResolver } from '../../../src/adt/package-hierarchy.js';
import { checkPackage, defaultSafetyConfig } from '../../../src/adt/safety.js';
import { pinnedFailure } from '../../../src/handlers/write/pinned-result.js';

it.each([true, false])(
  'does not serialize a native hierarchy diagnostic with minimalErrors=%s',
  async (minimalErrors) => {
    const resolver = createPinnedPackageHierarchyResolver(
      async () => {
        throw new AdtApiError('PRIVATE_HIERARCHY_SENTINEL', 503, '/sap/bc/adt/repository/nodestructure');
      },
      { deadline: Date.now() + 30_000, noReplay: true, retryTransientErrors: false },
    );
    let caught: unknown;
    try {
      await checkPackage({ ...defaultSafetyConfig(), allowedPackages: ['ZROOT/**'] }, 'ZCHILD', resolver);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    const result = pinnedFailure(caught, 'unchanged', 'package-preflight', false, { minimalErrors });
    expect(result.isError).toBe(true);
    const text = result.content[0].text!;
    expect(text).toContain('ZROOT');
    expect(text).toContain('503');
    expect(text).not.toContain('PRIVATE_HIERARCHY_SENTINEL');
  },
);
