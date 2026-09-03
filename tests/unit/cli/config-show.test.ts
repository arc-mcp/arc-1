/**
 * Tests for the `arc-1 config show` CLI subcommand.
 *
 * We test the resolver integration (resolveConfig → sources object) via direct
 * function calls rather than spawning the CLI process, since that would require
 * building dist/ and complicate the test.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveConfig } from '../../../src/server/config.js';

describe('config show — resolver contract', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SAP_') || key.startsWith('ARC1_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('returns defaults with source="default" when nothing set', () => {
    const { config, sources } = resolveConfig([]);
    expect(config.allowWrites).toBe(false);
    expect(config.allowedPackages).toEqual(['$TMP']);
    expect(config.blockedDataSources).toEqual([]);
    expect(sources.allowWrites).toBe('default');
    expect(sources.allowedPackages).toBe('default');
    expect(sources.denyActions).toBe('default');
  });

  it('attributes env-set values to { env: SAP_* }', () => {
    process.env.SAP_ALLOW_WRITES = 'true';
    process.env.SAP_ALLOWED_PACKAGES = '$TMP,Z*';
    process.env.SAP_BLOCKED_DATA_SOURCES = 'USR02';
    const { config, sources } = resolveConfig([]);
    expect(config.allowWrites).toBe(true);
    expect(sources.allowWrites).toEqual({ env: 'SAP_ALLOW_WRITES' });
    expect(config.allowedPackages).toEqual(['$TMP', 'Z*']);
    expect(sources.allowedPackages).toEqual({ env: 'SAP_ALLOWED_PACKAGES' });
    expect(config.blockedDataSources).toEqual(['USR02']);
    expect(sources.blockedDataSources).toEqual({ env: 'SAP_BLOCKED_DATA_SOURCES' });
  });

  it('attributes flag-set values to { flag: --* }', () => {
    const { config, sources } = resolveConfig(['--allow-writes', 'true', '--allow-free-sql', 'true']);
    expect(config.allowWrites).toBe(true);
    expect(config.allowFreeSQL).toBe(true);
    expect(sources.allowWrites).toEqual({ flag: '--allow-writes' });
    expect(sources.allowFreeSQL).toEqual({ flag: '--allow-free-sql' });
  });

  it('parses denyActions inline CSV and attributes source to env', () => {
    process.env.SAP_DENY_ACTIONS = 'SAPWrite.delete,SAPManage.flp_*';
    const { config, sources } = resolveConfig([]);
    expect(config.denyActions).toEqual(['SAPWrite.delete', 'SAPManage.flp_*']);
    expect(sources.denyActions).toEqual({ env: 'SAP_DENY_ACTIONS' });
  });

  it('throws migration error for legacy SAP_READ_ONLY', () => {
    process.env.SAP_READ_ONLY = 'true';
    expect(() => resolveConfig([])).toThrow(/SAP_READ_ONLY/);
  });

  it('throws fail-fast for invalid SAP_DENY_ACTIONS (unknown tool)', () => {
    process.env.SAP_DENY_ACTIONS = 'SAPFoo.bar';
    expect(() => resolveConfig([])).toThrow(/unknown tool 'SAPFoo'/);
  });

  it('throws fail-fast for SAP_DENY_ACTIONS cross-tool wildcard', () => {
    process.env.SAP_DENY_ACTIONS = '*.delete';
    expect(() => resolveConfig([])).toThrow(/cross-tool wildcards are not supported/);
  });
});
