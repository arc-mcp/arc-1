/**
 * Configuration parser for ARC-1.
 *
 * Resolves configuration from CLI flags, environment variables, and defaults.
 * Priority: CLI > env > .env > defaults
 *
 * Post-authz-refactor-v2 (v0.7):
 *   - Profile layer (`ARC1_PROFILE`) was removed. Use explicit `SAP_ALLOW_*` env vars.
 *   - Op-code allowlist/blocklist env vars (`SAP_ALLOWED_OPS` / `SAP_DISALLOWED_OPS`)
 *     were removed. Use `SAP_DENY_ACTIONS` for fine-grained per-action denials.
 *   - Single `ARC1_API_KEY` was removed. Use `ARC1_API_KEYS="key:profile"` instead.
 *   - Negated safety flags (`SAP_READ_ONLY`, `SAP_BLOCK_DATA`, `SAP_BLOCK_FREE_SQL`,
 *     `SAP_ENABLE_TRANSPORTS`, `SAP_ENABLE_GIT`) were replaced with positive opt-ins
 *     (`SAP_ALLOW_WRITES`, `SAP_ALLOW_DATA_PREVIEW`, `SAP_ALLOW_FREE_SQL`,
 *     `SAP_ALLOW_TRANSPORT_WRITES`, `SAP_ALLOW_GIT_WRITES`).
 *   - See docs_page/updating.md for the full migration table.
 */

import type { SafetyConfig } from '../adt/safety.js';
import { parseDenyActions, validateDenyActions } from './deny-actions.js';
import { logger } from './logger.js';
import type { ConfigSource, FeatureToggle, ServerConfig, TransportType } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

/**
 * Named API-key profiles — the safety config + scope set granted to a key
 * with that profile name. Used by multi-key auth (`ARC1_API_KEYS=key:profile`).
 *
 * For BTP/XSUAA deployments, the equivalent concept is role templates in
 * xs-security.json. The two stay conceptually aligned.
 */
export interface ApiKeyProfile {
  scopes: string[];
  /** Partial SafetyConfig — intersected with the server ceiling at request time. */
  safety: Partial<SafetyConfig>;
}

export const API_KEY_PROFILES: Record<string, ApiKeyProfile> = {
  viewer: {
    scopes: ['read'],
    safety: {
      allowWrites: false,
      allowDataPreview: false,
      allowFreeSQL: false,
      allowTransportWrites: false,
      allowGitWrites: false,
    },
  },
  'viewer-data': {
    scopes: ['read', 'data'],
    safety: {
      allowWrites: false,
      allowDataPreview: true,
      allowFreeSQL: false,
      allowTransportWrites: false,
      allowGitWrites: false,
    },
  },
  'viewer-sql': {
    scopes: ['read', 'data', 'sql'],
    safety: {
      allowWrites: false,
      allowDataPreview: true,
      allowFreeSQL: true,
      allowTransportWrites: false,
      allowGitWrites: false,
    },
  },
  developer: {
    scopes: ['read', 'write', 'transports', 'git'],
    safety: {
      allowWrites: true,
      allowDataPreview: false,
      allowFreeSQL: false,
      allowTransportWrites: true,
      allowGitWrites: true,
      allowedPackages: ['$TMP'],
    },
  },
  'developer-data': {
    scopes: ['read', 'write', 'data', 'transports', 'git'],
    safety: {
      allowWrites: true,
      allowDataPreview: true,
      allowFreeSQL: false,
      allowTransportWrites: true,
      allowGitWrites: true,
      allowedPackages: ['$TMP'],
    },
  },
  'developer-sql': {
    scopes: ['read', 'write', 'data', 'sql', 'transports', 'git'],
    safety: {
      allowWrites: true,
      allowDataPreview: true,
      allowFreeSQL: true,
      allowTransportWrites: true,
      allowGitWrites: true,
      allowedPackages: ['$TMP'],
    },
  },
  admin: {
    scopes: ['read', 'write', 'data', 'sql', 'transports', 'git', 'admin'],
    safety: {
      allowWrites: true,
      allowDataPreview: true,
      allowFreeSQL: true,
      allowTransportWrites: true,
      allowGitWrites: true,
      allowedPackages: [],
    },
  },
};

/**
 * Parse API keys string into structured array.
 * Format: "key1:profile1,key2:profile2"
 */
export function parseApiKeys(raw: string): Array<{ key: string; profile: string }> {
  const entries: Array<{ key: string; profile: string }> = [];
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.lastIndexOf(':');
    if (colonIdx === -1) {
      throw new Error(
        `Invalid API key entry '${trimmed}': expected 'key:profile' format. ` +
          `Valid profiles: ${Object.keys(API_KEY_PROFILES).join(', ')}`,
      );
    }
    const key = trimmed.slice(0, colonIdx);
    const profile = trimmed.slice(colonIdx + 1);
    if (!key) {
      throw new Error('Invalid API key entry: key cannot be empty');
    }
    if (!API_KEY_PROFILES[profile]) {
      throw new Error(
        `Invalid profile '${profile}' in API key entry. Valid profiles: ${Object.keys(API_KEY_PROFILES).join(', ')}`,
      );
    }
    entries.push({ key, profile });
  }
  if (entries.length === 0) {
    throw new Error('ARC1_API_KEYS is set but contains no valid entries. Format: "key1:profile1,key2:profile2"');
  }
  return entries;
}

/** Map of legacy env-var names → human-readable migration hint. */
const LEGACY_ENV_VARS: Record<string, string> = {
  SAP_READ_ONLY: 'Replaced by SAP_ALLOW_WRITES (inverted). Set SAP_ALLOW_WRITES=true to enable writes.',
  SAP_BLOCK_DATA:
    'Replaced by SAP_ALLOW_DATA_PREVIEW (inverted). Set SAP_ALLOW_DATA_PREVIEW=true to enable table preview.',
  SAP_BLOCK_FREE_SQL: 'Replaced by SAP_ALLOW_FREE_SQL (inverted). Set SAP_ALLOW_FREE_SQL=true to enable freestyle SQL.',
  SAP_ENABLE_TRANSPORTS:
    'Replaced by SAP_ALLOW_TRANSPORT_WRITES. Transport reads are always available; writes need SAP_ALLOW_TRANSPORT_WRITES=true + SAP_ALLOW_WRITES=true.',
  SAP_ENABLE_GIT:
    'Replaced by SAP_ALLOW_GIT_WRITES. Git reads are always available; writes need SAP_ALLOW_GIT_WRITES=true + SAP_ALLOW_WRITES=true.',
  SAP_ALLOWED_OPS:
    'Op-code allowlist was removed. Use SAP_DENY_ACTIONS for fine-grained per-action denials (e.g., SAP_DENY_ACTIONS="SAPWrite.delete,SAPManage.flp_*").',
  SAP_DISALLOWED_OPS: 'Op-code blocklist was removed. Use SAP_DENY_ACTIONS instead.',
  ARC1_PROFILE:
    'Server-side profile presets were removed. Set individual SAP_ALLOW_* flags (see .env.example for recipes).',
  ARC1_API_KEY:
    'Single API-key mode was removed. Use ARC1_API_KEYS="key:profile" with a profile name (valid: viewer, viewer-data, viewer-sql, developer, developer-data, developer-sql, admin).',
};

const LEGACY_CLI_FLAGS: Record<string, string> = {
  'read-only': LEGACY_ENV_VARS.SAP_READ_ONLY,
  'block-data': LEGACY_ENV_VARS.SAP_BLOCK_DATA,
  'block-free-sql': LEGACY_ENV_VARS.SAP_BLOCK_FREE_SQL,
  'enable-transports': LEGACY_ENV_VARS.SAP_ENABLE_TRANSPORTS,
  'enable-git': LEGACY_ENV_VARS.SAP_ENABLE_GIT,
  'allowed-ops': LEGACY_ENV_VARS.SAP_ALLOWED_OPS,
  'disallowed-ops': LEGACY_ENV_VARS.SAP_DISALLOWED_OPS,
  profile: LEGACY_ENV_VARS.ARC1_PROFILE,
  'api-key': LEGACY_ENV_VARS.ARC1_API_KEY,
};

/** Migration guard — throws a helpful error if any legacy identifier is set. */
function detectLegacyConfig(args: string[]): void {
  const violations: string[] = [];

  for (const env of Object.keys(LEGACY_ENV_VARS)) {
    if (process.env[env] !== undefined) {
      violations.push(`  ${env}: ${LEGACY_ENV_VARS[env]}`);
    }
  }

  for (const flag of Object.keys(LEGACY_CLI_FLAGS)) {
    if (args.some((a) => a === `--${flag}` || a.startsWith(`--${flag}=`))) {
      violations.push(`  --${flag}: ${LEGACY_CLI_FLAGS[flag]}`);
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Legacy authorization config detected (removed in v0.7):\n${violations.join('\n')}\n\nSee docs_page/updating.md#v07-authorization-refactor-breaking-change for the full migration guide.`,
    );
  }
}

/**
 * Parse CLI args + env into a `{ config, sources }` pair.
 * `sources` records where each field's value came from (default / env / flag / file).
 * Consumed by the startup effective-policy log and the `arc1 config show` subcommand.
 */
export function resolveConfig(args: string[]): { config: ServerConfig; sources: Record<string, ConfigSource> } {
  detectLegacyConfig(args);

  const config = { ...DEFAULT_CONFIG };
  const sources: Record<string, ConfigSource> = {};

  // ── Resolvers ──────────────────────────────────────────────────────
  const getFlag = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === `--${name}` && i + 1 < args.length) return args[i + 1];
      if (args[i]?.startsWith(prefix)) return args[i].slice(prefix.length);
    }
    return undefined;
  };

  const resolveStr = (flag: string, envVar: string, defaultVal: string, fieldName: string): string => {
    const flagVal = getFlag(flag);
    if (flagVal !== undefined) {
      sources[fieldName] = { flag: `--${flag}` };
      return flagVal;
    }
    if (process.env[envVar] !== undefined) {
      sources[fieldName] = { env: envVar };
      return process.env[envVar] as string;
    }
    sources[fieldName] = 'default';
    return defaultVal;
  };

  const resolveBool = (flag: string, envVar: string, defaultVal: boolean, fieldName: string): boolean => {
    const flagVal = getFlag(flag);
    if (flagVal !== undefined) {
      sources[fieldName] = { flag: `--${flag}` };
      return flagVal === 'true' || flagVal === '1';
    }
    if (process.env[envVar] !== undefined) {
      sources[fieldName] = { env: envVar };
      return process.env[envVar] === 'true' || process.env[envVar] === '1';
    }
    sources[fieldName] = 'default';
    return defaultVal;
  };

  const resolveFeature = (flag: string, envVar: string, fieldName: string): FeatureToggle => {
    const flagVal = getFlag(flag);
    if (flagVal !== undefined) {
      sources[fieldName] = { flag: `--${flag}` };
      if (flagVal === 'on' || flagVal === 'off') return flagVal;
      return 'auto';
    }
    const envVal = process.env[envVar];
    if (envVal !== undefined) {
      sources[fieldName] = { env: envVar };
      if (envVal === 'on' || envVal === 'off') return envVal;
      return 'auto';
    }
    sources[fieldName] = 'default';
    return 'auto';
  };

  const resolveOptionalStr = (flag: string, envVar: string, fieldName: string): string | undefined => {
    const flagVal = getFlag(flag);
    if (flagVal !== undefined) {
      sources[fieldName] = { flag: `--${flag}` };
      return flagVal;
    }
    if (process.env[envVar] !== undefined) {
      sources[fieldName] = { env: envVar };
      return process.env[envVar];
    }
    sources[fieldName] = 'default';
    return undefined;
  };

  // ── SAP Connection ─────────────────────────────────────────────────
  config.url = resolveStr('url', 'SAP_URL', '', 'url');
  config.username = resolveStr('user', 'SAP_USER', '', 'username');
  config.password = resolveStr('password', 'SAP_PASSWORD', '', 'password');
  config.client = resolveStr('client', 'SAP_CLIENT', '100', 'client');
  config.language = resolveStr('language', 'SAP_LANGUAGE', 'EN', 'language');
  config.insecure = resolveBool('insecure', 'SAP_INSECURE', false, 'insecure');

  // ── Cookie Auth ────────────────────────────────────────────────────
  config.cookieFile = resolveOptionalStr('cookie-file', 'SAP_COOKIE_FILE', 'cookieFile');
  config.cookieString = resolveOptionalStr('cookie-string', 'SAP_COOKIE_STRING', 'cookieString');

  // ── Transport ──────────────────────────────────────────────────────
  const transport = resolveStr('transport', 'SAP_TRANSPORT', 'stdio', 'transport');
  config.transport = (transport === 'http-streamable' ? 'http-streamable' : 'stdio') as TransportType;
  const httpAddrFlag = getFlag('http-addr');
  const httpAddrEnv = process.env.ARC1_HTTP_ADDR ?? process.env.SAP_HTTP_ADDR;
  if (httpAddrFlag !== undefined) {
    config.httpAddr = httpAddrFlag;
    sources.httpAddr = { flag: '--http-addr' };
  } else if (httpAddrEnv !== undefined) {
    config.httpAddr = httpAddrEnv;
    sources.httpAddr = process.env.ARC1_HTTP_ADDR !== undefined ? { env: 'ARC1_HTTP_ADDR' } : { env: 'SAP_HTTP_ADDR' };
  } else {
    config.httpAddr = '0.0.0.0:8080';
    sources.httpAddr = 'default';
  }
  const portOverride = getFlag('port') ?? process.env.ARC1_PORT;
  if (portOverride) {
    const parsedPort = Number.parseInt(portOverride, 10);
    if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      throw new Error(`Invalid port '${portOverride}': must be a number between 1 and 65535`);
    }
    const addrHost = config.httpAddr.includes(':') ? config.httpAddr.split(':')[0] : '0.0.0.0';
    config.httpAddr = `${addrHost}:${parsedPort}`;
    sources.httpAddr = getFlag('port') !== undefined ? { flag: '--port' } : { env: 'ARC1_PORT' };
  }

  // ── Safety (positive opt-ins) ──────────────────────────────────────
  config.allowWrites = resolveBool('allow-writes', 'SAP_ALLOW_WRITES', false, 'allowWrites');
  config.allowDataPreview = resolveBool('allow-data-preview', 'SAP_ALLOW_DATA_PREVIEW', false, 'allowDataPreview');
  config.allowFreeSQL = resolveBool('allow-free-sql', 'SAP_ALLOW_FREE_SQL', false, 'allowFreeSQL');
  config.allowTransportWrites = resolveBool(
    'allow-transport-writes',
    'SAP_ALLOW_TRANSPORT_WRITES',
    false,
    'allowTransportWrites',
  );
  config.allowGitWrites = resolveBool('allow-git-writes', 'SAP_ALLOW_GIT_WRITES', false, 'allowGitWrites');

  const pkgs = getFlag('allowed-packages') ?? process.env.SAP_ALLOWED_PACKAGES;
  if (pkgs !== undefined) {
    const raw = pkgs.split(',').map((p) => p.trim());
    const filtered = raw.filter((p) => p.length > 0);
    if (raw.length !== filtered.length) {
      logger.warn(
        "SAP_ALLOWED_PACKAGES contained empty entries — likely shell expansion of unset $VARs. Use single quotes: SAP_ALLOWED_PACKAGES='$TMP,Z*'",
        { raw: pkgs, parsed: filtered },
      );
    }
    config.allowedPackages = filtered;
    sources.allowedPackages =
      getFlag('allowed-packages') !== undefined ? { flag: '--allowed-packages' } : { env: 'SAP_ALLOWED_PACKAGES' };
  } else {
    sources.allowedPackages = 'default';
  }

  const transports = getFlag('allowed-transports') ?? process.env.SAP_ALLOWED_TRANSPORTS;
  if (transports !== undefined) {
    config.allowedTransports = transports
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    sources.allowedTransports =
      getFlag('allowed-transports') !== undefined
        ? { flag: '--allowed-transports' }
        : { env: 'SAP_ALLOWED_TRANSPORTS' };
  } else {
    sources.allowedTransports = 'default';
  }

  // ── Deny Actions (parsed + validated; fails fast on error) ─────────
  const denyActionsRaw = getFlag('deny-actions') ?? process.env.SAP_DENY_ACTIONS;
  if (denyActionsRaw) {
    const fromFile =
      denyActionsRaw.startsWith('/') ||
      denyActionsRaw.startsWith('./') ||
      denyActionsRaw.startsWith('~/') ||
      denyActionsRaw.startsWith('../');
    const parsed = parseDenyActions(denyActionsRaw);
    validateDenyActions(parsed);
    config.denyActions = parsed;
    sources.denyActions = fromFile
      ? { file: denyActionsRaw.replace(/^~/, process.env.HOME ?? '~') }
      : getFlag('deny-actions') !== undefined
        ? { flag: '--deny-actions' }
        : { env: 'SAP_DENY_ACTIONS' };
  } else {
    sources.denyActions = 'default';
  }

  // ── Features ───────────────────────────────────────────────────────
  config.featureAbapGit = resolveFeature('feature-abapgit', 'SAP_FEATURE_ABAPGIT', 'featureAbapGit');
  config.featureGcts = resolveFeature('feature-gcts', 'SAP_FEATURE_GCTS', 'featureGcts');
  config.featureRap = resolveFeature('feature-rap', 'SAP_FEATURE_RAP', 'featureRap');
  config.featureAmdp = resolveFeature('feature-amdp', 'SAP_FEATURE_AMDP', 'featureAmdp');
  config.featureUi5 = resolveFeature('feature-ui5', 'SAP_FEATURE_UI5', 'featureUi5');
  config.featureTransport = resolveFeature('feature-transport', 'SAP_FEATURE_TRANSPORT', 'featureTransport');
  config.featureHana = resolveFeature('feature-hana', 'SAP_FEATURE_HANA', 'featureHana');
  config.featureUi5Repo = resolveFeature('feature-ui5repo', 'SAP_FEATURE_UI5REPO', 'featureUi5Repo');
  config.featureFlp = resolveFeature('feature-flp', 'SAP_FEATURE_FLP', 'featureFlp');

  // ── System Type Detection ──────────────────────────────────────────
  const systemType = resolveStr('system-type', 'SAP_SYSTEM_TYPE', 'auto', 'systemType');
  config.systemType = (['btp', 'onprem'].includes(systemType) ? systemType : 'auto') as ServerConfig['systemType'];

  // ── Authentication ─────────────────────────────────────────────────
  const apiKeysRaw = getFlag('api-keys') ?? process.env.ARC1_API_KEYS;
  if (apiKeysRaw) {
    config.apiKeys = parseApiKeys(apiKeysRaw);
    sources.apiKeys = getFlag('api-keys') !== undefined ? { flag: '--api-keys' } : { env: 'ARC1_API_KEYS' };
  } else {
    sources.apiKeys = 'default';
  }

  config.oidcIssuer = resolveOptionalStr('oidc-issuer', 'SAP_OIDC_ISSUER', 'oidcIssuer');
  config.oidcAudience = resolveOptionalStr('oidc-audience', 'SAP_OIDC_AUDIENCE', 'oidcAudience');
  const clockTolerance = getFlag('oidc-clock-tolerance') ?? process.env.SAP_OIDC_CLOCK_TOLERANCE;
  if (clockTolerance) {
    const parsed = Number.parseInt(clockTolerance, 10);
    config.oidcClockTolerance = Number.isNaN(parsed) ? undefined : parsed;
  }
  config.xsuaaAuth = resolveBool('xsuaa-auth', 'SAP_XSUAA_AUTH', false, 'xsuaaAuth');

  // OAuth DCR client_id lifetime. 30 days default (matches typical refresh-token
  // lifetime). Hard-capped at 90 days — registrations longer than that should
  // use the pre-registered XSUAA client instead of DCR. Floor of 60 seconds to
  // keep the TTL meaningful (and prevent typos like "0" wiping every connect).
  const dcrTtlRaw = getFlag('oauth-dcr-ttl-seconds') ?? process.env.ARC1_OAUTH_DCR_TTL_SECONDS;
  if (dcrTtlRaw) {
    const parsed = Number.parseInt(dcrTtlRaw, 10);
    if (!Number.isNaN(parsed)) {
      const MIN = 60;
      const MAX = 90 * 24 * 60 * 60;
      config.oauthDcrTtlSeconds = Math.max(MIN, Math.min(MAX, parsed));
      sources.oauthDcrTtlSeconds =
        getFlag('oauth-dcr-ttl-seconds') !== undefined
          ? { flag: '--oauth-dcr-ttl-seconds' }
          : { env: 'ARC1_OAUTH_DCR_TTL_SECONDS' };
    }
  }

  // ── BTP ABAP Environment ───────────────────────────────────────────
  config.btpServiceKey = resolveOptionalStr('btp-service-key', 'SAP_BTP_SERVICE_KEY', 'btpServiceKey');
  config.btpServiceKeyFile = resolveOptionalStr(
    'btp-service-key-file',
    'SAP_BTP_SERVICE_KEY_FILE',
    'btpServiceKeyFile',
  );
  const cbPort = resolveStr('btp-oauth-callback-port', 'SAP_BTP_OAUTH_CALLBACK_PORT', '0', 'btpOAuthCallbackPort');
  config.btpOAuthCallbackPort = Number.parseInt(cbPort, 10) || 0;

  // ── Principal Propagation ──────────────────────────────────────────
  config.ppEnabled = resolveBool('pp-enabled', 'SAP_PP_ENABLED', false, 'ppEnabled');
  config.ppStrict = resolveBool('pp-strict', 'SAP_PP_STRICT', false, 'ppStrict');
  config.ppAllowSharedCookies = resolveBool(
    'pp-allow-shared-cookies',
    'SAP_PP_ALLOW_SHARED_COOKIES',
    false,
    'ppAllowSharedCookies',
  );

  // ── SAML Behavior ──────────────────────────────────────────────────
  config.disableSaml2 = resolveBool('disable-saml', 'SAP_DISABLE_SAML', false, 'disableSaml2');

  // ── Tool Mode ──────────────────────────────────────────────────────
  const toolMode = resolveStr('tool-mode', 'ARC1_TOOL_MODE', 'standard', 'toolMode');
  config.toolMode = (toolMode === 'hyperfocused' ? 'hyperfocused' : 'standard') as ServerConfig['toolMode'];

  // ── Lint ───────────────────────────────────────────────────────────
  config.abaplintConfig = resolveOptionalStr('abaplint-config', 'SAP_ABAPLINT_CONFIG', 'abaplintConfig');
  config.lintBeforeWrite = resolveBool('lint-before-write', 'SAP_LINT_BEFORE_WRITE', true, 'lintBeforeWrite');
  config.checkBeforeWrite = resolveBool('check-before-write', 'SAP_CHECK_BEFORE_WRITE', false, 'checkBeforeWrite');

  // ── Cache ──────────────────────────────────────────────────────────
  const cacheMode = resolveStr('cache', 'ARC1_CACHE', 'auto', 'cacheMode');
  config.cacheMode = (
    ['memory', 'sqlite', 'none'].includes(cacheMode) ? cacheMode : 'auto'
  ) as ServerConfig['cacheMode'];
  config.cacheFile = resolveStr('cache-file', 'ARC1_CACHE_FILE', '.arc1-cache.db', 'cacheFile');
  config.cacheWarmup = resolveBool('cache-warmup', 'ARC1_CACHE_WARMUP', false, 'cacheWarmup');
  config.cacheWarmupPackages = resolveStr(
    'cache-warmup-packages',
    'ARC1_CACHE_WARMUP_PACKAGES',
    '',
    'cacheWarmupPackages',
  );

  // ── Concurrency ────────────────────────────────────────────────────
  const maxConcurrent = getFlag('max-concurrent') ?? process.env.ARC1_MAX_CONCURRENT;
  if (maxConcurrent) {
    const parsed = Number.parseInt(maxConcurrent, 10);
    config.maxConcurrent = Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;
  }

  // ── CORS (browser-based MCP clients only) ──────────────────────────
  // Empty allowlist (the default) disables CORS. Native MCP clients don't need
  // this — only set when a browser UI calls /mcp directly.
  const originsRaw = getFlag('allowed-origins') ?? process.env.ARC1_ALLOWED_ORIGINS;
  if (originsRaw !== undefined) {
    config.allowedOrigins = originsRaw
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    sources.allowedOrigins =
      getFlag('allowed-origins') !== undefined ? { flag: '--allowed-origins' } : { env: 'ARC1_ALLOWED_ORIGINS' };
  } else {
    sources.allowedOrigins = 'default';
  }

  // ── Logging ────────────────────────────────────────────────────────
  config.logFile = resolveOptionalStr('log-file', 'ARC1_LOG_FILE', 'logFile');
  const logLevel = resolveStr('log-level', 'ARC1_LOG_LEVEL', 'info', 'logLevel');
  config.logLevel = (
    ['debug', 'info', 'warn', 'error'].includes(logLevel) ? logLevel : 'info'
  ) as ServerConfig['logLevel'];
  const logFormat = resolveStr('log-format', 'ARC1_LOG_FORMAT', 'text', 'logFormat');
  config.logFormat = (logFormat === 'json' ? 'json' : 'text') as ServerConfig['logFormat'];

  // ── Misc ───────────────────────────────────────────────────────────
  config.verbose = resolveBool('verbose', 'SAP_VERBOSE', false, 'verbose');
  if (config.verbose) config.logLevel = 'debug';

  // ── Startup Validation ─────────────────────────────────────────────
  validateConfig(config);

  return { config, sources };
}

/**
 * Thin wrapper around `resolveConfig` that returns only the config object.
 * Kept for callers that don't need per-field source attribution.
 */
export function parseArgs(args: string[]): ServerConfig {
  return resolveConfig(args).config;
}

/**
 * Validate configuration for internally consistent auth settings.
 * Fails fast at startup for invalid or dangerous config combinations.
 */
export function validateConfig(config: ServerConfig): void {
  if (config.oidcIssuer && !config.oidcAudience) {
    throw new Error(
      'SAP_OIDC_AUDIENCE is required when SAP_OIDC_ISSUER is set — ' +
        'audience validation prevents token confusion across services (RFC 9700 §2.3)',
    );
  }
  if (config.oidcAudience && !config.oidcIssuer) {
    throw new Error('SAP_OIDC_ISSUER is required when SAP_OIDC_AUDIENCE is set');
  }

  if (config.ppStrict && !config.ppEnabled) {
    throw new Error(
      'SAP_PP_STRICT=true requires SAP_PP_ENABLED=true — strict mode has no effect without principal propagation enabled',
    );
  }

  const hasCookieAuth = !!(config.cookieFile || config.cookieString);
  const hasBtpServiceKey = !!(config.btpServiceKey || config.btpServiceKeyFile);

  if (config.ppEnabled && hasCookieAuth && !config.ppAllowSharedCookies) {
    throw new Error(
      'SAP_PP_ENABLED=true is incompatible with SAP_COOKIE_FILE / SAP_COOKIE_STRING — shared cookies would leak into per-user requests. ' +
        'If you genuinely need both, set SAP_PP_ALLOW_SHARED_COOKIES=true (cookies will be used only for the shared client, not for per-user PP requests).',
    );
  }

  if (hasBtpServiceKey && hasCookieAuth) {
    throw new Error(
      'SAP_BTP_SERVICE_KEY is incompatible with SAP_COOKIE_FILE / SAP_COOKIE_STRING — pick one SAP auth method.',
    );
  }

  if (hasBtpServiceKey && config.ppEnabled) {
    throw new Error(
      'SAP_BTP_SERVICE_KEY (BTP ABAP) is incompatible with SAP_PP_ENABLED=true — BTP ABAP Environment is single-tenant OAuth and does not support principal propagation.',
    );
  }

  if (config.disableSaml2 && config.systemType === 'btp') {
    console.error(
      '[warn] SAP_DISABLE_SAML=true on a BTP system usually breaks login — BTP ABAP and S/4HANA Public Cloud require SAML. Continuing because you explicitly set this, but check docs/enterprise-auth.md if login starts failing.',
    );
  }
}
