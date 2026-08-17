import { describe, expect, it, vi } from 'vitest';

import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { detectContradictions, logEffectivePolicy } from '../../../src/server/effective-policy-log.js';
import { Logger } from '../../../src/server/logger.js';
import type { ConfigSource, ServerConfig } from '../../../src/server/types.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

describe('logEffectivePolicy', () => {
  it('emits structured log with safety fields and data-preview gzip state', () => {
    const logger = new Logger('text', false);
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    logEffectivePolicy(makeConfig({ allowWrites: true, allowedPackages: ['Z*'] }), {}, logger);

    // Structured log
    expect(infoSpy).toHaveBeenCalledWith(
      'effective policy resolved',
      expect.objectContaining({
        allowWrites: true,
        allowDataPreview: false,
        allowFreeSQL: false,
        allowTransportWrites: false,
        allowGitWrites: false,
        gzipDataPreviewBody: false,
        allowedPackages: ['Z*'],
        allowedTransports: [],
        denyActionsCount: 0,
      }),
    );
  });

  it('emits human-readable one-liner with YES/NO values', () => {
    const logger = new Logger('text', false);
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    logEffectivePolicy(
      makeConfig({
        allowWrites: true,
        allowDataPreview: true,
        gzipDataPreviewBody: true,
        allowTransportWrites: true,
        allowedPackages: ['$TMP', 'Z*'],
      }),
      {},
      logger,
    );

    const calls = infoSpy.mock.calls.map((c) => c[0]);
    const humanLine = calls.find((c) => typeof c === 'string' && c.startsWith('effective safety:'));
    expect(humanLine).toBeDefined();
    expect(humanLine).toContain('writes=YES');
    expect(humanLine).toContain('data=YES');
    expect(humanLine).toContain('sql=NO');
    expect(humanLine).toContain('transports=YES');
    expect(humanLine).toContain('git=NO');
    expect(humanLine).toContain('gzipDataPreview=YES');
    expect(humanLine).toContain('packages=[$TMP,Z*]');
    expect(humanLine).toContain('denyActions=0');
  });

  it('emits source attribution at debug level', () => {
    const logger = new Logger('text', true); // verbose for debug
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);

    const sources: Record<string, ConfigSource> = {
      allowWrites: { env: 'SAP_ALLOW_WRITES' },
      gzipDataPreviewBody: { env: 'SAP_GZIP_DATAPREVIEW_BODY' },
      allowedPackages: 'default',
      denyActions: { file: '/etc/deny.json' },
    };

    logEffectivePolicy(makeConfig({ allowWrites: true }), sources, logger);

    expect(debugSpy).toHaveBeenCalledWith(
      'effective-policy sources',
      expect.objectContaining({
        allowWrites: 'env SAP_ALLOW_WRITES',
        gzipDataPreviewBody: 'env SAP_GZIP_DATAPREVIEW_BODY',
        allowedPackages: 'default',
        denyActions: 'file /etc/deny.json',
      }),
    );
  });
});

describe('detectContradictions', () => {
  it('returns empty for a consistent config', () => {
    expect(detectContradictions(defaultSafetyConfig() as unknown as ServerConfig)).toEqual([]);
    expect(
      detectContradictions(
        makeConfig({
          allowWrites: true,
          allowTransportWrites: true,
          allowGitWrites: true,
          allowedPackages: ['$TMP'],
        }),
      ),
    ).toEqual([]);
  });

  it('flags allowTransportWrites=true with allowWrites=false', () => {
    const warnings = detectContradictions(makeConfig({ allowWrites: false, allowTransportWrites: true }));
    expect(warnings.some((w) => w.includes('allowTransportWrites=true has no effect when allowWrites=false'))).toBe(
      true,
    );
  });

  it('flags allowGitWrites=true with allowWrites=false', () => {
    const warnings = detectContradictions(makeConfig({ allowWrites: false, allowGitWrites: true }));
    expect(warnings.some((w) => w.includes('allowGitWrites=true has no effect when allowWrites=false'))).toBe(true);
  });

  it('flags data-preview gzip when neither data-preview gate can reach it', () => {
    const warnings = detectContradictions(
      makeConfig({ gzipDataPreviewBody: true, allowDataPreview: false, allowFreeSQL: false }),
    );
    expect(
      warnings.some((w) =>
        w.includes('gzipDataPreviewBody=true has no effect when allowDataPreview=false and allowFreeSQL=false'),
      ),
    ).toBe(true);
  });

  it('does not flag data-preview gzip when either data-preview gate can reach it', () => {
    expect(
      detectContradictions(makeConfig({ gzipDataPreviewBody: true, allowDataPreview: true, allowFreeSQL: false })),
    ).toEqual([]);
    expect(
      detectContradictions(makeConfig({ gzipDataPreviewBody: true, allowDataPreview: false, allowFreeSQL: true })),
    ).toEqual([]);
  });

  it('flags non-default allowedPackages with allowWrites=false', () => {
    const warnings = detectContradictions(makeConfig({ allowWrites: false, allowedPackages: ['Z*', 'Y_COMPANY'] }));
    expect(warnings.some((w) => w.includes('allowedPackages'))).toBe(true);
  });

  it('does NOT flag default allowedPackages=[$TMP] even with allowWrites=false', () => {
    const warnings = detectContradictions(makeConfig({ allowWrites: false, allowedPackages: ['$TMP'] }));
    // $TMP is the default — no user intent mismatch
    expect(warnings.filter((w) => w.includes('allowedPackages'))).toEqual([]);
  });

  it('flags denyActions entry as informational when already unreachable', () => {
    const warnings = detectContradictions(makeConfig({ allowWrites: false, denyActions: ['SAPWrite.delete'] }));
    expect(warnings.some((w) => w.includes("'SAPWrite.delete' is already unreachable"))).toBe(true);
  });

  it('does NOT double-warn when allowWrites=true', () => {
    // Everything enabled, no contradictions
    const warnings = detectContradictions(
      makeConfig({
        allowWrites: true,
        allowTransportWrites: true,
        allowGitWrites: true,
        allowedPackages: ['Z*'],
        denyActions: ['SAPWrite.delete'],
      }),
    );
    expect(warnings).toEqual([]);
  });
});
