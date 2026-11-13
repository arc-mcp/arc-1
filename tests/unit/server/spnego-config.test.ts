import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logAuthSummary } from '../../../src/server/auth-summary.js';
import { parseArgs, validateConfig } from '../../../src/server/config.js';
import { logger } from '../../../src/server/logger.js';
import { buildAdtConfig } from '../../../src/server/server.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

/** A minimal valid SPNEGO config: no other SAP credential. */
function spnegoConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...DEFAULT_CONFIG,
    url: 'https://sap.example.com',
    username: '',
    password: '',
    spnego: true,
    ...overrides,
  };
}

describe('SPNEGO configuration parsing', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SAP_') || key.startsWith('ARC1_')) delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  it('defaults to off, bootstrap mode and no SPN override', () => {
    const config = parseArgs([]);
    expect(config.spnego).toBe(false);
    expect(config.spnegoMode).toBe('bootstrap');
    expect(config.spnegoSpn).toBeUndefined();
  });

  it('reads the env vars', () => {
    process.env.SAP_URL = 'https://sap.example.com';
    process.env.SAP_SPNEGO = 'true';
    process.env.SAP_SPNEGO_SPN = 'HTTP/physical.example.com';
    process.env.SAP_SPNEGO_MODE = 'per-request';
    const config = parseArgs([]);
    expect(config.spnego).toBe(true);
    expect(config.spnegoSpn).toBe('HTTP/physical.example.com');
    expect(config.spnegoMode).toBe('per-request');
  });

  it('lets CLI flags win over the environment', () => {
    process.env.SAP_URL = 'https://sap.example.com';
    process.env.SAP_SPNEGO = 'false';
    const config = parseArgs(['--spnego', 'true', '--spnego-spn', 'HTTP/flag.example.com']);
    expect(config.spnego).toBe(true);
    expect(config.spnegoSpn).toBe('HTTP/flag.example.com');
  });

  it('rejects an unknown mode', () => {
    process.env.SAP_SPNEGO_MODE = 'kerberos-please';
    expect(() => parseArgs([])).toThrow(/expected bootstrap or per-request/);
  });
});

describe('SPNEGO fail-fast validation', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SAP_') || key.startsWith('ARC1_')) delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  it('accepts SPNEGO as the only SAP credential', () => {
    expect(() => validateConfig(spnegoConfig())).not.toThrow();
  });

  it('requires SAP_URL, because the SPN is derived from its host', () => {
    expect(() => validateConfig(spnegoConfig({ url: '' }))).toThrow(/requires SAP_URL/);
  });

  it('rejects principal propagation — SPNEGO cannot be a per-user identity', () => {
    expect(() => validateConfig(spnegoConfig({ ppEnabled: true }))).toThrow(/SAP_PP_ENABLED/);
  });

  it('rejects multi-target mode', () => {
    expect(() =>
      validateConfig(
        spnegoConfig({
          multiTargetEndpoints: true,
          transport: 'http-streamable',
          xsuaaAuth: true,
          cacheMode: 'none',
        }),
      ),
    ).toThrow();
  });

  it('rejects a second SAP credential', () => {
    expect(() => validateConfig(spnegoConfig({ username: 'DEVELOPER', password: 'secret' }))).toThrow(
      /SAP_USER \/ SAP_PASSWORD/,
    );
    expect(() => validateConfig(spnegoConfig({ cookieFile: '/tmp/cookies.txt' }))).toThrow(/SAP_COOKIE_FILE/);
    expect(() => validateConfig(spnegoConfig({ cookieString: 'MYSAPSSO2=x' }))).toThrow(/SAP_COOKIE_STRING/);
    expect(() => validateConfig(spnegoConfig({ btpServiceKey: '{}' }))).toThrow(/SAP_BTP_SERVICE_KEY/);
  });

  it('rejects a BTP destination, which carries its own credential', () => {
    process.env.SAP_BTP_DESTINATION = 'SAP_DEV';
    expect(() => validateConfig(spnegoConfig())).toThrow(/SAP_BTP_DESTINATION/);
  });

  it('warns instead of failing when the SPN or mode is set without enabling SPNEGO', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    validateConfig({ ...DEFAULT_CONFIG, url: 'https://sap.example.com', spnegoSpn: 'HTTP/x.example.com' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no effect without SAP_SPNEGO=true'));
  });
});

describe('SPNEGO client wiring', () => {
  it('resolves the SPN from SAP_URL for the shared client', () => {
    const adtConfig = buildAdtConfig(spnegoConfig());
    expect(adtConfig.spnego).toEqual({ spn: 'HTTP/sap.example.com', mode: 'bootstrap' });
  });

  it('honors an explicit SPN override', () => {
    const adtConfig = buildAdtConfig(spnegoConfig({ spnegoSpn: 'physical.example.com' }));
    expect(adtConfig.spnego?.spn).toBe('HTTP/physical.example.com');
  });

  it('never hands the process credential to a per-user client', () => {
    // A per-user (principal-propagation) client must authenticate as the END USER. Inheriting the
    // OS account's Kerberos ticket would silently widen every per-user call to a shared identity.
    const adtConfig = buildAdtConfig(spnegoConfig(), undefined, undefined, { perUser: true });
    expect(adtConfig.spnego).toBeUndefined();
    expect(adtConfig.username).toBeUndefined();
    expect(adtConfig.password).toBeUndefined();
  });

  it('leaves the ADT config untouched when SPNEGO is off', () => {
    expect(buildAdtConfig({ ...DEFAULT_CONFIG, url: 'https://sap.example.com' }).spnego).toBeUndefined();
  });
});

describe('SPNEGO startup auth summary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports a shared SAP identity', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    logAuthSummary(spnegoConfig());
    expect(info).toHaveBeenCalledWith(expect.stringContaining('SAP=spnego (shared)'));
  });

  it('flags an overridden SPN without revealing its value', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    logAuthSummary(spnegoConfig({ spnegoSpn: 'HTTP/secret-host.internal.example.com' }));
    const line = info.mock.calls[0]?.[0] as string;
    expect(line).toContain('spn=override');
    expect(line).not.toContain('secret-host');
  });

  it('names a non-default mode', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    logAuthSummary(spnegoConfig({ spnegoMode: 'per-request' }));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('spnego-mode=per-request'));
  });
});
