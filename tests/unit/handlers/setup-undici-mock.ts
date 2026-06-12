/**
 * Shared undici-mock prologue for the handler test files (split from the intent.test.ts monolith).
 *
 * One home for the fetch mock + AdtClient + createClient instead of ten drifting copies. vi.mock
 * registered here applies to the importing test file's module graph because vitest instantiates
 * this module (and runs the registration) inside that file's isolated module registry — which also
 * means `mockFetch` state never leaks across test files, exactly like the per-file
 * `const mockFetch = vi.fn()` it replaces.
 *
 * Import-order rules for consumers:
 *  - Static imports of OTHER src modules that (transitively) load undici — dispatch.js,
 *    feature-cache.js, write-helpers.js, … — stay FORBIDDEN in test files: under Biome's import
 *    sorting ('../../../src/…' sorts before './setup…') they would execute before this module
 *    registers the mock and capture the real undici.fetch. Keep them as `await import(...)` lines
 *    AFTER importing this helper, as every split file already does.
 *  - AdtClient is re-exported from here for the same reason: this module loads client.js
 *    dynamically AFTER `mockFetch` is assigned (the mock factory runs on undici's first load, so
 *    the binding must exist by then — the same ordering the per-file prologues relied on).
 */
import { vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

export const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

export const { AdtClient } = await import('../../../src/adt/client.js');

/** A real AdtClient over the mocked fetch, with an unrestricted safety config. */
export function createClient(): InstanceType<typeof AdtClient> {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'admin',
    password: 'secret',
    safety: unrestrictedSafetyConfig(),
  });
}
