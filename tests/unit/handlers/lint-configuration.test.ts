import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedFeatures } from '../../../src/adt/types.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { featuresOff } from './handler-test-config.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { runPreWriteLint } = await import('../../../src/handlers/write-helpers.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

describe('SAPLint configuration diagnostics', () => {
  let directory: string;
  beforeEach(() => {
    vi.resetAllMocks();
    resetCachedFeatures();
    directory = mkdtempSync(join(tmpdir(), 'arc1-lint-config-'));
  });
  afterEach(() => {
    resetCachedFeatures();
    rmSync(directory, { recursive: true, force: true });
  });

  const cases: Array<{
    name: string;
    config?: Partial<ServerConfig>;
    probe?: Partial<ResolvedFeatures>;
    customSyntax?: string | { release: string; language: string };
    expected: Record<string, unknown>;
    warn?: boolean;
  }> = [
    {
      name: 'probe preserves the explicit system-type override origin',
      probe: { systemType: 'btp', systemTypeSource: 'config', abapRelease: '758' },
      expected: {
        preset: 'cloud',
        presetSource: 'config',
        abapVersion: '758',
        abapVersionSource: 'probe',
        syntaxVersion: { release: 'Newest', language: 'Cloud' },
      },
    },
    {
      name: 'unknown system',
      expected: {
        preset: 'onprem',
        presetSource: 'default',
        abapVersion: 'unknown',
        abapVersionSource: 'unknown',
        syntaxVersion: 'v702',
      },
      warn: true,
    },
    {
      name: 'configured on-premise release',
      config: { systemType: 'onprem', abapRelease: '758' },
      expected: {
        preset: 'onprem',
        presetSource: 'config',
        abapVersion: '758',
        abapVersionSource: 'config',
        syntaxVersion: 'v758',
      },
    },
    {
      name: 'probe overrides explicit configuration',
      config: { systemType: 'btp', abapRelease: '758' },
      probe: { systemType: 'onprem', abapRelease: '750' },
      expected: {
        preset: 'onprem',
        presetSource: 'probe',
        abapVersion: '750',
        abapVersionSource: 'probe',
        syntaxVersion: 'v750',
      },
    },
    {
      name: 'configured Cloud without a release',
      config: { systemType: 'btp' },
      expected: {
        preset: 'cloud',
        presetSource: 'config',
        abapVersion: 'unknown',
        abapVersionSource: 'unknown',
        syntaxVersion: { release: 'Newest', language: 'Cloud' },
      },
      warn: true,
    },
    {
      name: 'custom syntax without a release',
      customSyntax: 'v754',
      expected: {
        preset: 'onprem',
        presetSource: 'default',
        abapVersion: 'unknown',
        abapVersionSource: 'unknown',
        syntaxVersion: 'v754',
      },
      warn: true,
    },
    {
      name: 'custom syntax overrides known release',
      config: { abapRelease: '758' },
      customSyntax: 'v750',
      expected: {
        preset: 'onprem',
        presetSource: 'default',
        abapVersion: '758',
        abapVersionSource: 'config',
        syntaxVersion: 'v750',
      },
    },
    {
      name: 'structured custom syntax',
      customSyntax: { release: 'v793', language: 'Normal' },
      expected: {
        presetSource: 'default',
        abapVersion: 'unknown',
        abapVersionSource: 'unknown',
        syntaxVersion: { release: 'v793', language: 'Normal' },
      },
      warn: true,
    },
  ];

  it.each(cases)(
    'reports effective settings for lint and blocked writes: $name',
    async ({ config, probe, customSyntax, expected, warn }) => {
      if (probe) setCachedFeatures({ ...featuresOff(), ...probe });
      const effectiveConfig = { ...DEFAULT_CONFIG, ...config };
      if (customSyntax) {
        effectiveConfig.abaplintConfig = join(directory, 'abaplint.json');
        writeFileSync(effectiveConfig.abaplintConfig, JSON.stringify({ syntax: { version: customSyntax } }));
      }
      const result = await handleToolCall(createClient(), effectiveConfig, 'SAPLint', { action: 'list_rules' });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text);
      expect(data).toMatchObject(expected);
      if (warn) {
        expect(data.warnings).toHaveLength(1);
        expect(data.warnings[0]).toContain(JSON.stringify(data.syntaxVersion));
        expect(data.warnings[0]).toContain('SAP_ABAP_RELEASE');
        expect(data.warnings[0]).not.toContain('[object Object]');
      } else {
        expect(data.warnings).toEqual([]);
      }
      const lint = runPreWriteLint('REPORT zbad.\nnot_an_abap_statement.', 'PROG', 'ZBAD', effectiveConfig);
      expect(lint.blocked).toBe(true);
      expect(lint.result?.content[0]?.text).toContain(`abaplint syntax ${JSON.stringify(expected.syntaxVersion)}`);
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it('uses the selected target for both values and their provenance', async () => {
    setCachedFeatures({ ...featuresOff(), systemType: 'btp', abapRelease: '816' });
    setCachedFeatures({ ...featuresOff(), systemType: 'onprem' }, 'A4H/001');
    const result = await handleToolCall(
      createClient(),
      { ...DEFAULT_CONFIG, targetId: 'A4H/001', abapRelease: '758' },
      'SAPLint',
      { action: 'list_rules' },
    );
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      preset: 'onprem',
      presetSource: 'probe',
      abapVersion: '758',
      abapVersionSource: 'config',
      syntaxVersion: 'v758',
      warnings: [],
    });
  });
});
