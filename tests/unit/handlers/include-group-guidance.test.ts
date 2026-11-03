import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { enforceAllowedPackageForObjectUrl } = await import('../../../src/handlers/write-helpers.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const include = '/sap/bc/adt/programs/includes/lz_grouptop';
const grouped = '/sap/bc/adt/functions/groups/z_group/includes/lz_grouptop';
const clientFor = (allowedPackages: string[]) =>
  new AdtClient({
    baseUrl: 'https://sap.example',
    safety: { ...unrestrictedSafetyConfig(), allowedPackages },
  });
beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
  resetCachedFeatures();
});
describe('include package-resolution guidance (#1161)', () => {
  for (const allowedPackages of [['$TMP'], ['*']]) {
    for (const minimalErrors of [false, true]) {
      it.each(['SAPWrite', 'SAPActivate'])(
        `%s explains missing group with ${JSON.stringify(allowedPackages)} (minimal=${minimalErrors})`,
        async (tool) => {
          const client = clientFor(allowedPackages);
          const resolve = vi.spyOn(client, 'resolveObjectPackage').mockResolvedValue('');
          const args =
            tool === 'SAPWrite'
              ? {
                  action: 'update',
                  type: 'INCL',
                  name: 'LZ_GROUPTOP',
                  source: 'FUNCTION-POOL Z_GROUP.',
                  lintBeforeWrite: false,
                }
              : { type: 'INCL', name: 'LZ_GROUPTOP' };
          const result = await handleToolCall(client, { ...DEFAULT_CONFIG, minimalErrors }, tool, args);
          expect(result.isError).toBe(true);
          const text = String(result.content[0]?.text);
          expect(text).toContain('group=<FUGR>');
          expect(text).toContain('SAPWrite or SAPActivate');
          expect(text).not.toContain('allowedPackages is restricted');
          expect(resolve.mock.calls[0][0].toLowerCase()).toBe(include);
          expect(mockFetch).not.toHaveBeenCalled();
        },
      );
    }
  }
  it.each(['/sap/bc/adt/oo/classes/z_class', grouped])('does not give missing-group advice for %s', async (url) => {
    const client = clientFor(['*']);
    vi.spyOn(client, 'resolveObjectPackage').mockResolvedValue('');
    const options = { includeGroupHint: true };
    await expect(enforceAllowedPackageForObjectUrl(client, url, 'Write', undefined, options)).rejects.not.toThrow(
      'group=<FUGR>',
    );
    await expect(enforceAllowedPackageForObjectUrl(client, url, 'Write', undefined, options)).rejects.toThrow(
      'verified package',
    );
  });
  it('SAPActivate batch explains missing group', async () => {
    const client = clientFor(['*']);
    vi.spyOn(client, 'resolveObjectPackage').mockResolvedValue('');
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', {
      objects: [{ type: 'INCL', name: 'LZ_GROUPTOP' }],
    });
    expect(result.content[0]?.text).toContain('group=<FUGR>');
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('still requires a package for multi-target policy with an empty global list', async () => {
    const client = new AdtClient({
      baseUrl: 'https://sap.example',
      safety: {
        ...unrestrictedSafetyConfig(),
        allowedPackages: [],
        multiTargetWrite: {
          target: 'A4H-001',
          enabled: true,
          allowedPackages: ['$TMP'],
          allowedTransports: [],
          serverAllowedTransports: [],
        },
      },
    });
    const resolve = vi.spyOn(client, 'resolveObjectPackage').mockResolvedValue('');
    await expect(enforceAllowedPackageForObjectUrl(client, include, 'Write')).rejects.toThrow('verified package');
    expect(resolve).toHaveBeenCalledOnce();
  });
  it('keeps the existing empty-list shortcut on single-target clients', async () => {
    const client = clientFor([]);
    const resolve = vi.spyOn(client, 'resolveObjectPackage').mockResolvedValue('');
    await expect(enforceAllowedPackageForObjectUrl(client, include, 'Write')).resolves.toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });
  it('does not suggest an unsupported group argument to SAPManage', async () => {
    const client = clientFor(['*']);
    vi.spyOn(client, 'resolveObjectPackage').mockResolvedValue('');
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPManage', {
      action: 'set_api_state',
      objectUri: include,
      apiState: 'RELEASED',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('verified package');
    expect(result.content[0]?.text).not.toContain('group=<FUGR>');
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('uses the real group package and still rejects a disallowed one', async () => {
    const client = clientFor(['$TMP']);
    const resolve = vi.spyOn(client, 'resolveObjectPackage').mockResolvedValue('Z_DENIED');
    await expect(enforceAllowedPackageForObjectUrl(client, grouped, 'Write')).rejects.toThrow();
    resolve.mockResolvedValue('$TMP');
    await expect(enforceAllowedPackageForObjectUrl(client, grouped, 'Write')).resolves.toBe('$TMP');
  });
});
