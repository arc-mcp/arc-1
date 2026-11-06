import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig, validateConfig } from '../../../src/server/config.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

describe('explicit multi-target authorization configuration', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (/^(SAP_|ARC1_|VCAP_)/.test(key)) delete process.env[key];
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  function enableMulti(): void {
    process.env.ARC1_MULTI_TARGET_ENDPOINTS = 'true';
    process.env.SAP_TRANSPORT = 'http-streamable';
    process.env.SAP_XSUAA_AUTH = 'true';
    process.env.ARC1_CACHE = 'none';
  }

  it.each([false, true])('defaults to standard with multi endpoints %s', (multi) => {
    if (multi) enableMulti();
    const { config, sources } = resolveConfig([]);
    expect(config.multiTargetAuthorization).toBe('standard');
    expect(sources.multiTargetAuthorization).toBe('default');
  });

  it.each(['standard', '  standard \n'])('permits explicit standard for single-target deployments: %j', (value) => {
    process.env.ARC1_MULTI_TARGET_AUTHORIZATION = value;
    const { config, sources } = resolveConfig([]);
    expect(config.multiTargetAuthorization).toBe('standard');
    expect(sources.multiTargetAuthorization).toEqual({ env: 'ARC1_MULTI_TARGET_AUTHORIZATION' });
    expect(config.multiTargetEndpoints).toBe(false);
  });

  describe.each([false, true])('explicit standard mode with multi endpoints %s', (multi) => {
    it.each(['standard', ' \t standard \n'])(
      'resolves environment value %j to the unchanged default config',
      (value) => {
        if (multi) enableMulti();
        const expected = resolveConfig([]).config;
        process.env.ARC1_MULTI_TARGET_AUTHORIZATION = value;
        const { config, sources } = resolveConfig([]);
        expect(config).toEqual(expected);
        expect(config.multiTargetAuthorization).toBe('standard');
        expect(sources.multiTargetAuthorization).toEqual({ env: 'ARC1_MULTI_TARGET_AUTHORIZATION' });
      },
    );

    it.each([['--multi-target-authorization=standard'], ['--multi-target-authorization', ' \t standard \n']])(
      'resolves CLI value %j and preserves CLI precedence',
      (...args) => {
        if (multi) enableMulti();
        const expected = resolveConfig([]).config;
        process.env.ARC1_MULTI_TARGET_AUTHORIZATION = 'xsuaa-attribute';
        const { config, sources } = resolveConfig(args);
        expect(config).toEqual(expected);
        expect(config.multiTargetAuthorization).toBe('standard');
        expect(sources.multiTargetAuthorization).toEqual({ flag: '--multi-target-authorization' });
      },
    );
  });

  describe.each([false, true])('unsupported mode with multi endpoints %s', (multi) => {
    it.each(['legacy', ' \t legacy \n'])('rejects %j in both environment and CLI inputs', (value) => {
      if (multi) enableMulti();
      process.env.ARC1_MULTI_TARGET_AUTHORIZATION = value;
      expect(() => resolveConfig([])).toThrow('must be standard or xsuaa-attribute');
      // A valid environment value must not hide an invalid CLI override.
      process.env.ARC1_MULTI_TARGET_AUTHORIZATION = multi ? 'xsuaa-attribute' : 'standard';
      expect(() => resolveConfig([`--multi-target-authorization=${value}`])).toThrow(
        'must be standard or xsuaa-attribute',
      );
      expect(() => resolveConfig(['--multi-target-authorization', value])).toThrow(
        'must be standard or xsuaa-attribute',
      );
    });
  });

  it.each(['xsuaa-attribute', ' \t xsuaa-attribute \n'])('enables only explicit enforcement: %j', (value) => {
    enableMulti();
    process.env.ARC1_MULTI_TARGET_AUTHORIZATION = value;
    const { config, sources } = resolveConfig([]);
    expect(config.multiTargetAuthorization).toBe('xsuaa-attribute');
    expect(sources.multiTargetAuthorization).toEqual({ env: 'ARC1_MULTI_TARGET_AUTHORIZATION' });
  });

  it.each(['', ' ', '\t\n', 'XSUAA-ATTRIBUTE', 'Standard', 'Legacy', 'true', 'all-readers', 'auto', '*'])(
    'rejects explicit invalid values instead of falling back: %j',
    (value) => {
      enableMulti();
      process.env.ARC1_MULTI_TARGET_AUTHORIZATION = value;
      expect(() => resolveConfig([])).toThrow('ARC1_MULTI_TARGET_AUTHORIZATION must be standard or xsuaa-attribute');
    },
  );

  it('rejects misplaced enforcement before other multi prerequisites can be mistaken for protection', () => {
    process.env.ARC1_MULTI_TARGET_AUTHORIZATION = 'xsuaa-attribute';
    expect(() => resolveConfig([])).toThrow('requires ARC1_MULTI_TARGET_ENDPOINTS=true');
  });

  it('uses normal CLI precedence for the same setting without silently accepting an empty flag', () => {
    enableMulti();
    process.env.ARC1_MULTI_TARGET_AUTHORIZATION = 'standard';
    const { config, sources } = resolveConfig(['--multi-target-authorization=xsuaa-attribute']);
    expect(config.multiTargetAuthorization).toBe('xsuaa-attribute');
    expect(sources.multiTargetAuthorization).toEqual({ flag: '--multi-target-authorization' });
    expect(resolveConfig(['--multi-target-authorization', 'standard']).config.multiTargetAuthorization).toBe(
      'standard',
    );
    expect(() => resolveConfig(['--multi-target-authorization='])).toThrow('empty values are invalid');
    expect(() => resolveConfig(['--multi-target-authorization', '  '])).toThrow('empty values are invalid');
  });

  it('keeps explicit enforcement and invalid CLI values authoritative over standard environment mode', () => {
    enableMulti();
    process.env.ARC1_MULTI_TARGET_AUTHORIZATION = 'standard';
    expect(resolveConfig(['--multi-target-authorization=xsuaa-attribute']).config.multiTargetAuthorization).toBe(
      'xsuaa-attribute',
    );
    for (const value of ['', 'auto', 'Standard', 'Legacy', 'legacy']) {
      expect(() => resolveConfig([`--multi-target-authorization=${value}`])).toThrow(
        'ARC1_MULTI_TARGET_AUTHORIZATION must be standard or xsuaa-attribute',
      );
    }
  });

  it('rejects a flag missing its value and otherwise permits intentional deletion on a new startup', () => {
    enableMulti();
    expect(() => resolveConfig(['--multi-target-authorization'])).toThrow('requires standard or xsuaa-attribute');
    process.env.ARC1_MULTI_TARGET_AUTHORIZATION = 'xsuaa-attribute';
    expect(() => resolveConfig(['--multi-target-authorization'])).toThrow('requires standard or xsuaa-attribute');
    expect(resolveConfig([]).config.multiTargetAuthorization).toBe('xsuaa-attribute');
    delete process.env.ARC1_MULTI_TARGET_AUTHORIZATION;
    expect(resolveConfig([]).config.multiTargetAuthorization).toBe('standard');
  });

  it.each(['', 'unknown', 'legacy', undefined])('requires canonical programmatic config: %j', (value) => {
    const config = { ...DEFAULT_CONFIG, multiTargetAuthorization: value } as unknown as ServerConfig;
    expect(() => validateConfig(config)).toThrow('ARC1_MULTI_TARGET_AUTHORIZATION');
  });
});
