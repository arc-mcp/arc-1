import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_KEY_PROFILES,
  parseApiKeys,
  parseArgs,
  resolveConfig,
  validateConfig,
} from '../../../src/server/config.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

describe('parseArgs', () => {
  // Save and restore env to avoid test pollution
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Clear SAP_* and ARC1_* env vars for clean test state
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SAP_') || key.startsWith('TEST_SAP_') || key.startsWith('ARC1_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('returns defaults when no args or env vars', () => {
    const config = parseArgs([]);
    expect(config.url).toBe('');
    expect(config.client).toBe('100');
    expect(config.language).toBe('EN');
    expect(config.transport).toBe('stdio');
    expect(config.allowWrites).toBe(false);
    expect(config.allowFreeSQL).toBe(false);
    expect(config.allowDataPreview).toBe(false);
    expect(config.allowTransportWrites).toBe(false);
    expect(config.allowGitWrites).toBe(false);
    expect(config.denyActions).toEqual([]);
    expect(config.verbose).toBe(false);
  });

  it('parses CLI flags (--flag value)', () => {
    const config = parseArgs(['--url', 'http://sap:8000', '--user', 'admin', '--password', 'secret']);
    expect(config.url).toBe('http://sap:8000');
    expect(config.username).toBe('admin');
    expect(config.password).toBe('secret');
  });

  it('parses CLI flags (--flag=value)', () => {
    const config = parseArgs(['--url=http://sap:8000', '--client=100']);
    expect(config.url).toBe('http://sap:8000');
    expect(config.client).toBe('100');
  });

  it('reads from environment variables', () => {
    process.env.SAP_URL = 'http://env:8000';
    process.env.SAP_USER = 'envuser';
    process.env.SAP_CLIENT = '200';
    const config = parseArgs([]);
    expect(config.url).toBe('http://env:8000');
    expect(config.username).toBe('envuser');
    expect(config.client).toBe('200');
  });

  it('CLI flags take precedence over env vars', () => {
    process.env.SAP_URL = 'http://env:8000';
    const config = parseArgs(['--url', 'http://cli:9000']);
    expect(config.url).toBe('http://cli:9000');
  });

  it('parses boolean flags', () => {
    const config = parseArgs(['--allow-writes', 'true', '--verbose', 'true']);
    expect(config.allowWrites).toBe(true);
    expect(config.verbose).toBe(true);
  });

  it('parses boolean env vars', () => {
    process.env.SAP_ALLOW_WRITES = 'true';
    process.env.SAP_ALLOW_FREE_SQL = '1';
    const config = parseArgs([]);
    expect(config.allowWrites).toBe(true);
    expect(config.allowFreeSQL).toBe(true);
  });

  it('parses --allow-git-writes flag', () => {
    const config = parseArgs(['--allow-git-writes', 'true']);
    expect(config.allowGitWrites).toBe(true);
  });

  it('parses SAP_ALLOW_GIT_WRITES env var', () => {
    process.env.SAP_ALLOW_GIT_WRITES = '1';
    const config = parseArgs([]);
    expect(config.allowGitWrites).toBe(true);
  });

  it('defaults allowGitWrites to false without explicit configuration', () => {
    const config = parseArgs([]);
    expect(config.allowGitWrites).toBe(false);
  });

  it('--allow-git-writes takes precedence over SAP_ALLOW_GIT_WRITES env', () => {
    process.env.SAP_ALLOW_GIT_WRITES = 'false';
    const config = parseArgs(['--allow-git-writes', 'true']);
    expect(config.allowGitWrites).toBe(true);
  });

  it('parses transport type', () => {
    const config = parseArgs(['--transport', 'http-streamable']);
    expect(config.transport).toBe('http-streamable');
  });

  it('defaults unknown transport to stdio', () => {
    const config = parseArgs(['--transport', 'invalid']);
    expect(config.transport).toBe('stdio');
  });

  it('parses --port flag and overrides httpAddr port', () => {
    const config = parseArgs(['--port', '9090']);
    expect(config.httpAddr).toBe('0.0.0.0:9090');
  });

  it('parses ARC1_HTTP_ADDR env var', () => {
    process.env.ARC1_HTTP_ADDR = '127.0.0.1:19081';
    try {
      const config = parseArgs([]);
      expect(config.httpAddr).toBe('127.0.0.1:19081');
    } finally {
      delete process.env.ARC1_HTTP_ADDR;
    }
  });

  it('parses SAP_HTTP_ADDR env var as legacy-compatible alias', () => {
    process.env.SAP_HTTP_ADDR = '127.0.0.1:19082';
    try {
      const config = parseArgs([]);
      expect(config.httpAddr).toBe('127.0.0.1:19082');
    } finally {
      delete process.env.SAP_HTTP_ADDR;
    }
  });

  it('prefers ARC1_HTTP_ADDR over SAP_HTTP_ADDR when both are set', () => {
    process.env.ARC1_HTTP_ADDR = '127.0.0.1:19081';
    process.env.SAP_HTTP_ADDR = '127.0.0.1:19082';
    try {
      const config = parseArgs([]);
      expect(config.httpAddr).toBe('127.0.0.1:19081');
    } finally {
      delete process.env.ARC1_HTTP_ADDR;
      delete process.env.SAP_HTTP_ADDR;
    }
  });

  it('ARC1_PORT env var overrides httpAddr port', () => {
    process.env.ARC1_PORT = '7070';
    try {
      const config = parseArgs([]);
      expect(config.httpAddr).toBe('0.0.0.0:7070');
    } finally {
      delete process.env.ARC1_PORT;
    }
  });

  it('--port takes precedence over ARC1_PORT', () => {
    process.env.ARC1_PORT = '7070';
    try {
      const config = parseArgs(['--port', '9090']);
      expect(config.httpAddr).toBe('0.0.0.0:9090');
    } finally {
      delete process.env.ARC1_PORT;
    }
  });

  it('--port preserves custom host from --http-addr', () => {
    const config = parseArgs(['--http-addr', '127.0.0.1:8080', '--port', '9999']);
    expect(config.httpAddr).toBe('127.0.0.1:9999');
  });

  it('throws on invalid --port value', () => {
    expect(() => parseArgs(['--port', 'notanumber'])).toThrow(/Invalid port/);
    expect(() => parseArgs(['--port', '99999'])).toThrow(/Invalid port/);
    expect(() => parseArgs(['--port', '0'])).toThrow(/Invalid port/);
  });

  it('parses feature toggles', () => {
    const config = parseArgs([
      '--feature-abapgit',
      'on',
      '--feature-gcts',
      'off',
      '--feature-rap',
      'off',
      '--feature-flp',
      'on',
    ]);
    expect(config.featureAbapGit).toBe('on');
    expect(config.featureGcts).toBe('off');
    expect(config.featureRap).toBe('off');
    expect(config.featureFlp).toBe('on');
  });

  it('parses SAP_FEATURE_GCTS env var', () => {
    process.env.SAP_FEATURE_GCTS = 'on';
    const config = parseArgs([]);
    expect(config.featureGcts).toBe('on');
  });

  it('defaults unknown feature toggle to auto', () => {
    const config = parseArgs(['--feature-abapgit', 'invalid']);
    expect(config.featureAbapGit).toBe('auto');
  });

  it('parses allowed packages as comma-separated list', () => {
    process.env.SAP_ALLOWED_PACKAGES = 'Z*,$TMP,YFOO';
    const config = parseArgs([]);
    expect(config.allowedPackages).toEqual(['Z*', '$TMP', 'YFOO']);
  });

  it('defaults allowedPackages to [$TMP] when not configured', () => {
    const config = parseArgs([]);
    expect(config.allowedPackages).toEqual(['$TMP']);
  });

  it('--allowed-packages overrides the $TMP default', () => {
    process.env.SAP_ALLOWED_PACKAGES = 'Z*,$TMP';
    const config = parseArgs([]);
    expect(config.allowedPackages).toEqual(['Z*', '$TMP']);
  });

  it('filters out empty entries from SAP_ALLOWED_PACKAGES (e.g. shell-expanded unset $VARs)', () => {
    // Simulates `SAP_ALLOWED_PACKAGES=$tmp,$locals,$*` with unset shell vars → ",,"
    process.env.SAP_ALLOWED_PACKAGES = ',,';
    const config = parseArgs([]);
    expect(config.allowedPackages).toEqual([]);
  });

  it('filters empty entries but keeps valid ones', () => {
    process.env.SAP_ALLOWED_PACKAGES = 'Z*,,$TMP,';
    const config = parseArgs([]);
    expect(config.allowedPackages).toEqual(['Z*', '$TMP']);
  });

  describe('legacy config migration errors', () => {
    it('throws migration error for SAP_READ_ONLY', () => {
      process.env.SAP_READ_ONLY = 'true';
      expect(() => parseArgs([])).toThrow(/SAP_READ_ONLY.*Replaced by SAP_ALLOW_WRITES/);
    });

    it('throws migration error for SAP_BLOCK_DATA', () => {
      process.env.SAP_BLOCK_DATA = 'true';
      expect(() => parseArgs([])).toThrow(/SAP_BLOCK_DATA.*Replaced by SAP_ALLOW_DATA_PREVIEW/);
    });

    it('throws migration error for SAP_BLOCK_FREE_SQL', () => {
      process.env.SAP_BLOCK_FREE_SQL = 'true';
      expect(() => parseArgs([])).toThrow(/SAP_BLOCK_FREE_SQL.*Replaced by SAP_ALLOW_FREE_SQL/);
    });

    it('throws migration error for SAP_ENABLE_TRANSPORTS', () => {
      process.env.SAP_ENABLE_TRANSPORTS = 'true';
      expect(() => parseArgs([])).toThrow(/SAP_ENABLE_TRANSPORTS.*Replaced by SAP_ALLOW_TRANSPORT_WRITES/);
    });

    it('throws migration error for SAP_ENABLE_GIT', () => {
      process.env.SAP_ENABLE_GIT = 'true';
      expect(() => parseArgs([])).toThrow(/SAP_ENABLE_GIT.*Replaced by SAP_ALLOW_GIT_WRITES/);
    });

    it('throws migration error for SAP_ALLOWED_OPS', () => {
      process.env.SAP_ALLOWED_OPS = 'RSQ';
      expect(() => parseArgs([])).toThrow(/SAP_ALLOWED_OPS.*Op-code allowlist was removed/);
    });

    it('throws migration error for SAP_DISALLOWED_OPS', () => {
      process.env.SAP_DISALLOWED_OPS = 'D';
      expect(() => parseArgs([])).toThrow(/SAP_DISALLOWED_OPS.*Op-code blocklist was removed/);
    });

    it('throws migration error for ARC1_PROFILE', () => {
      process.env.ARC1_PROFILE = 'developer';
      expect(() => parseArgs([])).toThrow(/ARC1_PROFILE.*Server-side profile presets were removed/);
    });

    it('throws migration error for ARC1_API_KEY', () => {
      process.env.ARC1_API_KEY = 'abc';
      expect(() => parseArgs([])).toThrow(/ARC1_API_KEY.*Single API-key mode was removed/);
    });

    it('throws migration error for --read-only flag', () => {
      expect(() => parseArgs(['--read-only', 'true'])).toThrow(/--read-only.*SAP_ALLOW_WRITES/);
    });

    it('throws migration error for --profile flag', () => {
      expect(() => parseArgs(['--profile', 'developer'])).toThrow(/--profile.*profile presets were removed/);
    });

    it('migration error message points to updating.md', () => {
      process.env.SAP_READ_ONLY = 'true';
      expect(() => parseArgs([])).toThrow(/docs_page\/updating\.md/);
    });
  });

  it('parses cookie auth options', () => {
    const config = parseArgs(['--cookie-file', '/path/cookies.txt', '--cookie-string', 'a=b; c=d']);
    expect(config.cookieFile).toBe('/path/cookies.txt');
    expect(config.cookieString).toBe('a=b; c=d');
  });

  it('parses --disable-saml and --pp-allow-shared-cookies flags', () => {
    const config = parseArgs(['--disable-saml', 'true', '--pp-allow-shared-cookies', 'true']);
    expect(config.disableSaml2).toBe(true);
    expect(config.ppAllowSharedCookies).toBe(true);
  });

  it('parses SAP_DISABLE_SAML and SAP_PP_ALLOW_SHARED_COOKIES env vars', () => {
    process.env.SAP_DISABLE_SAML = 'true';
    process.env.SAP_PP_ALLOW_SHARED_COOKIES = '1';
    const config = parseArgs([]);
    expect(config.disableSaml2).toBe(true);
    expect(config.ppAllowSharedCookies).toBe(true);
  });

  it('defaults xsuaaAuth to false', () => {
    const config = parseArgs([]);
    expect(config.xsuaaAuth).toBe(false);
  });

  it('parses --xsuaa-auth flag', () => {
    const config = parseArgs(['--xsuaa-auth', 'true']);
    expect(config.xsuaaAuth).toBe(true);
  });

  it('parses SAP_XSUAA_AUTH env var', () => {
    process.env.SAP_XSUAA_AUTH = 'true';
    const config = parseArgs([]);
    expect(config.xsuaaAuth).toBe(true);
  });

  // --- BTP ABAP Environment (service key) ---

  it('defaults BTP service key fields', () => {
    const config = parseArgs([]);
    expect(config.btpServiceKey).toBeUndefined();
    expect(config.btpServiceKeyFile).toBeUndefined();
    expect(config.btpOAuthCallbackPort).toBe(0);
  });

  it('parses --btp-service-key flag', () => {
    const config = parseArgs(['--btp-service-key', '{"uaa":{}}']);
    expect(config.btpServiceKey).toBe('{"uaa":{}}');
  });

  it('parses SAP_BTP_SERVICE_KEY env var', () => {
    process.env.SAP_BTP_SERVICE_KEY = '{"uaa":{"url":"x"}}';
    const config = parseArgs([]);
    expect(config.btpServiceKey).toBe('{"uaa":{"url":"x"}}');
  });

  it('parses --btp-service-key-file flag', () => {
    const config = parseArgs(['--btp-service-key-file', '/path/to/key.json']);
    expect(config.btpServiceKeyFile).toBe('/path/to/key.json');
  });

  it('parses SAP_BTP_SERVICE_KEY_FILE env var', () => {
    process.env.SAP_BTP_SERVICE_KEY_FILE = '/path/to/key.json';
    const config = parseArgs([]);
    expect(config.btpServiceKeyFile).toBe('/path/to/key.json');
  });

  it('parses --btp-oauth-callback-port flag', () => {
    const config = parseArgs(['--btp-oauth-callback-port', '3001']);
    expect(config.btpOAuthCallbackPort).toBe(3001);
  });

  it('parses SAP_BTP_OAUTH_CALLBACK_PORT env var', () => {
    process.env.SAP_BTP_OAUTH_CALLBACK_PORT = '4001';
    const config = parseArgs([]);
    expect(config.btpOAuthCallbackPort).toBe(4001);
  });

  // --- System Type Detection ---

  it('defaults systemType to auto', () => {
    const config = parseArgs([]);
    expect(config.systemType).toBe('auto');
  });

  it('parses --system-type btp flag', () => {
    const config = parseArgs(['--system-type', 'btp']);
    expect(config.systemType).toBe('btp');
  });

  it('parses --system-type onprem flag', () => {
    const config = parseArgs(['--system-type', 'onprem']);
    expect(config.systemType).toBe('onprem');
  });

  it('parses SAP_SYSTEM_TYPE env var', () => {
    process.env.SAP_SYSTEM_TYPE = 'btp';
    const config = parseArgs([]);
    expect(config.systemType).toBe('btp');
  });

  it('defaults unknown system type to auto', () => {
    const config = parseArgs(['--system-type', 'invalid']);
    expect(config.systemType).toBe('auto');
  });

  it('CLI --system-type takes precedence over SAP_SYSTEM_TYPE env', () => {
    process.env.SAP_SYSTEM_TYPE = 'onprem';
    const config = parseArgs(['--system-type', 'btp']);
    expect(config.systemType).toBe('btp');
  });

  // --- ABAP Release Override ---

  it('defaults abapRelease to undefined', () => {
    const config = parseArgs([]);
    expect(config.abapRelease).toBeUndefined();
  });

  it('parses --abap-release flag', () => {
    const config = parseArgs(['--abap-release', '758']);
    expect(config.abapRelease).toBe('758');
  });

  it('parses SAP_ABAP_RELEASE env var', () => {
    process.env.SAP_ABAP_RELEASE = '750';
    const config = parseArgs([]);
    expect(config.abapRelease).toBe('750');
  });

  it('CLI --abap-release takes precedence over SAP_ABAP_RELEASE env', () => {
    process.env.SAP_ABAP_RELEASE = '750';
    const config = parseArgs(['--abap-release', '7.58']);
    expect(config.abapRelease).toBe('7.58');
  });

  // --- allowDataPreview (replaces blockData) ---

  it('parses --allow-data-preview flag', () => {
    const config = parseArgs(['--allow-data-preview', 'true']);
    expect(config.allowDataPreview).toBe(true);
  });

  it('parses SAP_ALLOW_DATA_PREVIEW env var', () => {
    process.env.SAP_ALLOW_DATA_PREVIEW = '1';
    const config = parseArgs([]);
    expect(config.allowDataPreview).toBe(true);
  });

  it('defaults allowDataPreview to false', () => {
    const config = parseArgs([]);
    expect(config.allowDataPreview).toBe(false);
  });

  // --- maxConcurrent ---

  it('defaults maxConcurrent to 10', () => {
    const config = parseArgs([]);
    expect(config.maxConcurrent).toBe(10);
  });

  it('parses --max-concurrent flag', () => {
    const config = parseArgs(['--max-concurrent', '5']);
    expect(config.maxConcurrent).toBe(5);
  });

  it('parses ARC1_MAX_CONCURRENT env var', () => {
    process.env.ARC1_MAX_CONCURRENT = '20';
    const config = parseArgs([]);
    expect(config.maxConcurrent).toBe(20);
  });

  it('clamps maxConcurrent to minimum 1', () => {
    const config = parseArgs(['--max-concurrent', '0']);
    expect(config.maxConcurrent).toBe(1);
  });

  it('clamps invalid maxConcurrent to 1', () => {
    const config = parseArgs(['--max-concurrent', 'notanumber']);
    expect(config.maxConcurrent).toBe(1);
  });

  it('--max-concurrent takes precedence over ARC1_MAX_CONCURRENT', () => {
    process.env.ARC1_MAX_CONCURRENT = '20';
    const config = parseArgs(['--max-concurrent', '3']);
    expect(config.maxConcurrent).toBe(3);
  });

  // --- oauthDcrTtlSeconds ---

  it('defaults oauthDcrTtlSeconds to 30 days', () => {
    const config = parseArgs([]);
    expect(config.oauthDcrTtlSeconds).toBe(30 * 24 * 60 * 60);
  });

  it('parses --oauth-dcr-ttl-seconds flag', () => {
    const config = parseArgs(['--oauth-dcr-ttl-seconds', '3600']);
    expect(config.oauthDcrTtlSeconds).toBe(3600);
  });

  it('parses ARC1_OAUTH_DCR_TTL_SECONDS env var', () => {
    process.env.ARC1_OAUTH_DCR_TTL_SECONDS = '7200';
    const config = parseArgs([]);
    expect(config.oauthDcrTtlSeconds).toBe(7200);
  });

  it('clamps positive oauthDcrTtlSeconds to a 60-second floor', () => {
    const config = parseArgs(['--oauth-dcr-ttl-seconds', '5']);
    expect(config.oauthDcrTtlSeconds).toBe(60);
  });

  it('clamps oauthDcrTtlSeconds to a 90-day ceiling', () => {
    const ninetyOneDays = 91 * 24 * 60 * 60;
    const config = parseArgs(['--oauth-dcr-ttl-seconds', String(ninetyOneDays)]);
    expect(config.oauthDcrTtlSeconds).toBe(90 * 24 * 60 * 60);
  });

  it('explicit 0 disables TTL (bypasses 60-second floor)', () => {
    const config = parseArgs(['--oauth-dcr-ttl-seconds', '0']);
    expect(config.oauthDcrTtlSeconds).toBe(0);
  });

  it('negative values are normalized to 0 (TTL disabled)', () => {
    const config = parseArgs(['--oauth-dcr-ttl-seconds', '-1']);
    expect(config.oauthDcrTtlSeconds).toBe(0);
  });

  it('keeps default oauthDcrTtlSeconds when value is not parseable', () => {
    const config = parseArgs(['--oauth-dcr-ttl-seconds', 'notanumber']);
    expect(config.oauthDcrTtlSeconds).toBe(30 * 24 * 60 * 60);
  });

  it('--oauth-dcr-ttl-seconds takes precedence over ARC1_OAUTH_DCR_TTL_SECONDS', () => {
    process.env.ARC1_OAUTH_DCR_TTL_SECONDS = '7200';
    const config = parseArgs(['--oauth-dcr-ttl-seconds', '3600']);
    expect(config.oauthDcrTtlSeconds).toBe(3600);
  });

  // --- dcrSigningSecret ---

  it('dcrSigningSecret is undefined by default (falls back to XSUAA clientsecret in xsuaa.ts)', () => {
    const config = parseArgs([]);
    expect(config.dcrSigningSecret).toBeUndefined();
  });

  it('parses --dcr-signing-secret flag', () => {
    const config = parseArgs(['--dcr-signing-secret', 'super-stable-hmac-key']);
    expect(config.dcrSigningSecret).toBe('super-stable-hmac-key');
  });

  it('parses ARC1_DCR_SIGNING_SECRET env var', () => {
    process.env.ARC1_DCR_SIGNING_SECRET = 'env-derived-hmac-key';
    const config = parseArgs([]);
    expect(config.dcrSigningSecret).toBe('env-derived-hmac-key');
  });

  it('--dcr-signing-secret takes precedence over ARC1_DCR_SIGNING_SECRET', () => {
    process.env.ARC1_DCR_SIGNING_SECRET = 'env-value';
    const config = parseArgs(['--dcr-signing-secret', 'flag-value']);
    expect(config.dcrSigningSecret).toBe('flag-value');
  });

  // --- API_KEY_PROFILES ---

  it('API_KEY_PROFILES contains all 7 expected profiles', () => {
    expect(Object.keys(API_KEY_PROFILES).sort()).toEqual([
      'admin',
      'developer',
      'developer-data',
      'developer-sql',
      'viewer',
      'viewer-data',
      'viewer-sql',
    ]);
  });

  it('API_KEY_PROFILES.viewer has read-only scopes and restrictive safety', () => {
    expect(API_KEY_PROFILES.viewer.scopes).toEqual(['read']);
    expect(API_KEY_PROFILES.viewer.safety.allowWrites).toBe(false);
    expect(API_KEY_PROFILES.viewer.safety.allowDataPreview).toBe(false);
    expect(API_KEY_PROFILES.viewer.safety.allowFreeSQL).toBe(false);
  });

  it('API_KEY_PROFILES.developer includes transports and git scopes', () => {
    expect(API_KEY_PROFILES.developer.scopes).toContain('read');
    expect(API_KEY_PROFILES.developer.scopes).toContain('write');
    expect(API_KEY_PROFILES.developer.scopes).toContain('transports');
    expect(API_KEY_PROFILES.developer.scopes).toContain('git');
    expect(API_KEY_PROFILES.developer.safety.allowWrites).toBe(true);
    expect(API_KEY_PROFILES.developer.safety.allowTransportWrites).toBe(true);
    expect(API_KEY_PROFILES.developer.safety.allowGitWrites).toBe(true);
    expect(API_KEY_PROFILES.developer.safety.allowedPackages).toEqual(['$TMP']);
  });

  it('API_KEY_PROFILES.admin has all 7 scopes', () => {
    expect(API_KEY_PROFILES.admin.scopes.sort()).toEqual([
      'admin',
      'data',
      'git',
      'read',
      'sql',
      'transports',
      'write',
    ]);
  });

  it('API_KEY_PROFILES.developer-sql allows SQL and data preview', () => {
    expect(API_KEY_PROFILES['developer-sql'].scopes).toContain('sql');
    expect(API_KEY_PROFILES['developer-sql'].scopes).toContain('data');
    expect(API_KEY_PROFILES['developer-sql'].safety.allowFreeSQL).toBe(true);
    expect(API_KEY_PROFILES['developer-sql'].safety.allowDataPreview).toBe(true);
  });

  // --- Multi-key API keys ---

  it('parses ARC1_API_KEYS env var', () => {
    process.env.ARC1_API_KEYS = 'key1:viewer,key2:developer';
    const config = parseArgs([]);
    expect(config.apiKeys).toEqual([
      { key: 'key1', profile: 'viewer' },
      { key: 'key2', profile: 'developer' },
    ]);
  });

  it('parses --api-keys flag', () => {
    const config = parseArgs(['--api-keys', 'abc:viewer-data,def:developer-sql']);
    expect(config.apiKeys).toEqual([
      { key: 'abc', profile: 'viewer-data' },
      { key: 'def', profile: 'developer-sql' },
    ]);
  });

  it('--api-keys flag takes precedence over ARC1_API_KEYS env', () => {
    process.env.ARC1_API_KEYS = 'env-key:viewer';
    const config = parseArgs(['--api-keys', 'cli-key:developer']);
    expect(config.apiKeys).toEqual([{ key: 'cli-key', profile: 'developer' }]);
  });

  it('apiKeys is undefined when not configured', () => {
    const config = parseArgs([]);
    expect(config.apiKeys).toBeUndefined();
  });

  // --- resolveConfig (per-field source attribution) ---

  it('resolveConfig returns per-field sources (default when unset)', () => {
    const { sources } = resolveConfig([]);
    expect(sources.allowWrites).toBe('default');
    expect(sources.allowedPackages).toBe('default');
  });

  it('resolveConfig reports env source for env-set fields', () => {
    process.env.SAP_ALLOW_WRITES = 'true';
    const { sources } = resolveConfig([]);
    expect(sources.allowWrites).toEqual({ env: 'SAP_ALLOW_WRITES' });
  });

  it('resolveConfig reports flag source for CLI-set fields', () => {
    const { sources } = resolveConfig(['--allow-writes', 'true']);
    expect(sources.allowWrites).toEqual({ flag: '--allow-writes' });
  });

  it('resolveConfig returns both config and sources', () => {
    const result = resolveConfig(['--allow-writes', 'true']);
    expect(result.config.allowWrites).toBe(true);
    expect(result.sources.allowWrites).toEqual({ flag: '--allow-writes' });
  });
});

// ─── parseApiKeys ───────────────────────────────────────────────────

describe('parseApiKeys', () => {
  it('parses single key:profile pair', () => {
    expect(parseApiKeys('mykey:viewer')).toEqual([{ key: 'mykey', profile: 'viewer' }]);
  });

  it('parses multiple key:profile pairs', () => {
    expect(parseApiKeys('k1:viewer,k2:developer,k3:viewer-sql')).toEqual([
      { key: 'k1', profile: 'viewer' },
      { key: 'k2', profile: 'developer' },
      { key: 'k3', profile: 'viewer-sql' },
    ]);
  });

  it('trims whitespace', () => {
    expect(parseApiKeys(' k1:viewer , k2:developer ')).toEqual([
      { key: 'k1', profile: 'viewer' },
      { key: 'k2', profile: 'developer' },
    ]);
  });

  it('handles key with colons (e.g. base64)', () => {
    // Last colon splits key from profile — keys may contain colons
    expect(parseApiKeys('abc:def:ghi:viewer')).toEqual([{ key: 'abc:def:ghi', profile: 'viewer' }]);
  });

  it('throws on missing colon separator', () => {
    expect(() => parseApiKeys('keyonly')).toThrow(/expected 'key:profile' format/);
  });

  it('throws on empty key', () => {
    expect(() => parseApiKeys(':viewer')).toThrow(/key cannot be empty/);
  });

  it('throws on invalid profile name', () => {
    expect(() => parseApiKeys('mykey:nonexistent')).toThrow(/Invalid profile 'nonexistent'/);
  });

  it('throws on empty string', () => {
    expect(() => parseApiKeys('')).toThrow(/no valid entries/);
  });

  it('skips empty segments from trailing comma', () => {
    expect(parseApiKeys('k1:viewer,')).toEqual([{ key: 'k1', profile: 'viewer' }]);
  });

  it('accepts all valid profile names', () => {
    const profiles = ['viewer', 'viewer-data', 'viewer-sql', 'developer', 'developer-data', 'developer-sql'];
    for (const p of profiles) {
      expect(parseApiKeys(`testkey:${p}`)).toEqual([{ key: 'testkey', profile: p }]);
    }
  });
});

// ─── validateConfig ─────────────────────────────────────────────────

describe('validateConfig', () => {
  it('throws when oidcIssuer is set without oidcAudience', () => {
    expect(() =>
      validateConfig({
        ...DEFAULT_CONFIG,
        oidcIssuer: 'https://login.microsoftonline.com/tenant/v2.0',
      }),
    ).toThrow('SAP_OIDC_AUDIENCE is required when SAP_OIDC_ISSUER is set');
  });

  it('throws when oidcAudience is set without oidcIssuer', () => {
    expect(() =>
      validateConfig({
        ...DEFAULT_CONFIG,
        oidcAudience: 'api://arc-1',
      }),
    ).toThrow('SAP_OIDC_ISSUER is required when SAP_OIDC_AUDIENCE is set');
  });

  it('accepts config with both oidcIssuer and oidcAudience', () => {
    expect(() =>
      validateConfig({
        ...DEFAULT_CONFIG,
        oidcIssuer: 'https://login.microsoftonline.com/tenant/v2.0',
        oidcAudience: 'api://arc-1',
      }),
    ).not.toThrow();
  });

  it('accepts config with neither oidcIssuer nor oidcAudience', () => {
    expect(() => validateConfig({ ...DEFAULT_CONFIG })).not.toThrow();
  });

  it('throws when ppStrict is true without ppEnabled', () => {
    expect(() =>
      validateConfig({
        ...DEFAULT_CONFIG,
        ppStrict: true,
        ppEnabled: false,
      }),
    ).toThrow('SAP_PP_STRICT=true requires SAP_PP_ENABLED=true');
  });

  it('accepts ppStrict with ppEnabled', () => {
    expect(() =>
      validateConfig({
        ...DEFAULT_CONFIG,
        ppStrict: true,
        ppEnabled: true,
      }),
    ).not.toThrow();
  });

  it('throws when ppEnabled is combined with cookieFile without opt-in', () => {
    expect(() =>
      validateConfig({
        ...DEFAULT_CONFIG,
        ppEnabled: true,
        cookieFile: '/tmp/cookies.txt',
      }),
    ).toThrow('SAP_PP_ENABLED=true is incompatible with SAP_COOKIE_FILE / SAP_COOKIE_STRING');
  });

  it('throws when ppEnabled is combined with cookieString without opt-in', () => {
    expect(() =>
      validateConfig({
        ...DEFAULT_CONFIG,
        ppEnabled: true,
        cookieString: 'SAP_SESSIONID=abc',
      }),
    ).toThrow('SAP_PP_ENABLED=true is incompatible with SAP_COOKIE_FILE / SAP_COOKIE_STRING');
  });

  it('accepts ppEnabled with cookies when SAP_PP_ALLOW_SHARED_COOKIES=true', () => {
    expect(() =>
      validateConfig({
        ...DEFAULT_CONFIG,
        ppEnabled: true,
        cookieFile: '/tmp/cookies.txt',
        ppAllowSharedCookies: true,
      }),
    ).not.toThrow();
  });

  it('throws when btpServiceKey is combined with cookies', () => {
    expect(() =>
      validateConfig({
        ...DEFAULT_CONFIG,
        btpServiceKey: '{"uaa":{"url":"https://uaa.example.com"}}',
        cookieFile: '/tmp/cookies.txt',
      }),
    ).toThrow('SAP_BTP_SERVICE_KEY is incompatible with SAP_COOKIE_FILE / SAP_COOKIE_STRING');
  });

  it('throws when btpServiceKey is combined with ppEnabled', () => {
    expect(() =>
      validateConfig({
        ...DEFAULT_CONFIG,
        btpServiceKey: '{"uaa":{"url":"https://uaa.example.com"}}',
        ppEnabled: true,
      }),
    ).toThrow('SAP_BTP_SERVICE_KEY (BTP ABAP) is incompatible with SAP_PP_ENABLED=true');
  });

  it('warns to stderr (without throwing) when disableSaml2=true on btp system', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          disableSaml2: true,
          systemType: 'btp',
        }),
      ).not.toThrow();
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('SAP_DISABLE_SAML=true on a BTP system usually breaks login'),
      );
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('warns to stderr (without throwing) when dcrSigningSecret is set with xsuaaAuth=false', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() =>
        validateConfig({
          ...DEFAULT_CONFIG,
          dcrSigningSecret: 'some-stable-secret',
          xsuaaAuth: false,
        }),
      ).not.toThrow();
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('ARC1_DCR_SIGNING_SECRET is set but SAP_XSUAA_AUTH=false'),
      );
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('does not warn about dcrSigningSecret when xsuaaAuth=true', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      validateConfig({
        ...DEFAULT_CONFIG,
        dcrSigningSecret: 'some-stable-secret',
        xsuaaAuth: true,
      });
      expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining('ARC1_DCR_SIGNING_SECRET'));
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('does not warn when dcrSigningSecret is unset', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      validateConfig({
        ...DEFAULT_CONFIG,
        xsuaaAuth: false,
      });
      expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining('ARC1_DCR_SIGNING_SECRET'));
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('parseArgs fails with oidcIssuer but no oidcAudience', () => {
    process.env.SAP_OIDC_ISSUER = 'https://example.com';
    expect(() => parseArgs([])).toThrow('SAP_OIDC_AUDIENCE is required');
  });
});
