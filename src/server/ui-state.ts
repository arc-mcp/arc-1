import type { ConfigSource, ServerConfig } from './types.js';

const FEATURE_KEYS = ['hana', 'abapGit', 'gcts', 'rap', 'amdp', 'ui5', 'transport', 'ui5repo', 'flp'] as const;

export interface UiOverview {
  app: {
    name: 'ARC-1';
    version: string;
    startedAt: string;
    uptimeSeconds: number;
    pid: number;
    node: string;
  };
  transport: {
    type: ServerConfig['transport'];
    httpAddr: string;
    uiMode: ServerConfig['uiMode'];
    uiAddr: string;
  };
  safety: ReturnType<typeof sanitizeSafetyConfig>;
  auth: ReturnType<typeof summarizeAuthConfig>;
  cache: {
    mode: ServerConfig['cacheMode'];
    file?: string;
  };
}

export function buildUiOverview(config: ServerConfig, version: string, startedAt: string): UiOverview {
  return {
    app: {
      name: 'ARC-1',
      version,
      startedAt,
      uptimeSeconds: Math.floor(process.uptime()),
      pid: process.pid,
      node: process.version,
    },
    transport: {
      type: config.transport,
      httpAddr: config.httpAddr,
      uiMode: config.uiMode,
      uiAddr: config.uiAddr,
    },
    safety: sanitizeSafetyConfig(config),
    auth: summarizeAuthConfig(config),
    cache: {
      mode: config.cacheMode,
      file: config.cacheMode === 'sqlite' ? config.cacheFile : undefined,
    },
  };
}

export function sanitizeConfigForUi(config: ServerConfig): Record<string, unknown> {
  return {
    url: sanitizeUrl(config.url),
    username: config.username,
    password: { configured: config.password.length > 0 },
    client: config.client,
    language: config.language,
    insecure: config.insecure,
    cookieFile: config.cookieFile,
    cookieString: { configured: !!config.cookieString },
    transport: config.transport,
    httpAddr: config.httpAddr,
    uiMode: config.uiMode,
    uiAddr: config.uiAddr,
    uiOpen: config.uiOpen,
    safety: sanitizeSafetyConfig(config),
    features: {
      abapGit: config.featureAbapGit,
      gcts: config.featureGcts,
      rap: config.featureRap,
      amdp: config.featureAmdp,
      ui5: config.featureUi5,
      transport: config.featureTransport,
      hana: config.featureHana,
      ui5repo: config.featureUi5Repo,
      flp: config.featureFlp,
    },
    system: {
      type: config.systemType,
      abapRelease: config.abapRelease,
      disableSaml2: config.disableSaml2,
    },
    auth: summarizeAuthConfig(config),
    btp: {
      serviceKey: { configured: !!config.btpServiceKey },
      serviceKeyFile: config.btpServiceKeyFile,
      oauthCallbackPort: config.btpOAuthCallbackPort,
    },
    principalPropagation: {
      enabled: config.ppEnabled,
      strict: config.ppStrict,
      allowSharedCookies: config.ppAllowSharedCookies,
    },
    logging: {
      file: config.logFile,
      level: config.logLevel,
      format: config.logFormat,
      verbose: config.verbose,
    },
    toolMode: config.toolMode,
    plugins: {
      configured: config.plugins.length,
      paths: config.plugins,
      allowExecute: config.allowPluginExecute,
      allowRawWrites: config.allowPluginRawWrites,
    },
    lint: {
      config: config.abaplintConfig,
      beforeWrite: config.lintBeforeWrite,
      checkBeforeWrite: config.checkBeforeWrite,
    },
    cache: {
      mode: config.cacheMode,
      file: config.cacheMode === 'sqlite' ? config.cacheFile : undefined,
    },
    concurrency: {
      maxConcurrent: config.maxConcurrent,
    },
    rateLimiting: {
      authRateLimit: config.authRateLimit,
      mcpRateLimit: config.rateLimit,
    },
    browser: {
      allowedOrigins: config.allowedOrigins,
    },
  };
}

export function sanitizeConfigSourcesForUi(sources: Record<string, ConfigSource>): Record<string, ConfigSource> {
  return { ...sources };
}

export function sanitizeFeaturesForUi(features: unknown): Record<string, unknown> {
  if (!features || typeof features !== 'object') {
    return {
      probed: false,
      message: 'Feature probe has not completed yet.',
    };
  }

  const source = features as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of FEATURE_KEYS) {
    const status = sanitizeFeatureStatus(key, source[key]);
    if (status) result[key] = status;
  }
  if (typeof source.abapRelease === 'string') result.abapRelease = source.abapRelease;
  if (source.systemType === 'btp' || source.systemType === 'onprem') result.systemType = source.systemType;
  if (source.discoveryMap instanceof Map) result.discovery = { endpointCount: source.discoveryMap.size };
  const textSearch = sanitizeTextSearch(source.textSearch);
  if (textSearch) result.textSearch = textSearch;
  const authProbe = sanitizeAuthProbe(source.authProbe);
  if (authProbe) result.authProbe = authProbe;
  result.probed = true;
  return result;
}

function sanitizeFeatureStatus(name: string, value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  if (typeof source.available !== 'boolean') return undefined;
  return {
    id: typeof source.id === 'string' ? source.id : name,
    available: source.available,
    mode: typeof source.mode === 'string' ? source.mode : 'unknown',
    ...(typeof source.message === 'string' ? { message: source.message } : {}),
    ...(typeof source.probedAt === 'string' ? { probedAt: source.probedAt } : {}),
  };
}

function sanitizeTextSearch(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  if (typeof source.available !== 'boolean') return undefined;
  return {
    available: source.available,
    ...(typeof source.reason === 'string' ? { reason: source.reason } : {}),
  };
}

function sanitizeAuthProbe(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  return {
    searchAccess: source.searchAccess === true,
    ...(typeof source.searchReason === 'string' ? { searchReason: source.searchReason } : {}),
    transportAccess: source.transportAccess === true,
    ...(typeof source.transportReason === 'string' ? { transportReason: source.transportReason } : {}),
  };
}

export function sanitizeSafetyConfig(config: ServerConfig): Record<string, unknown> {
  return {
    allowWrites: config.allowWrites,
    allowDataPreview: config.allowDataPreview,
    allowFreeSQL: config.allowFreeSQL,
    allowTransportWrites: config.allowTransportWrites,
    allowGitWrites: config.allowGitWrites,
    allowedPackages: config.allowedPackages,
    allowedTransports: config.allowedTransports,
    denyActions: config.denyActions,
    readOnlyDefault: !config.allowWrites,
  };
}

export function summarizeAuthConfig(config: ServerConfig): Record<string, unknown> {
  return {
    apiKeys: {
      count: config.apiKeys?.length ?? 0,
      profiles: config.apiKeys?.map((entry) => entry.profile) ?? [],
    },
    oidc: {
      configured: !!config.oidcIssuer,
      issuer: config.oidcIssuer,
      audience: config.oidcAudience,
      clockTolerance: config.oidcClockTolerance,
    },
    xsuaa: {
      enabled: config.xsuaaAuth,
      dcrTtlSeconds: config.oauthDcrTtlSeconds,
      dcrSigningSecret: { configured: !!config.dcrSigningSecret },
    },
    sap: {
      basic: !!(config.username && config.password),
      cookieFile: !!config.cookieFile,
      cookieString: !!config.cookieString,
      btpServiceKey: !!(config.btpServiceKey || config.btpServiceKeyFile),
      destination: !!process.env.SAP_BTP_DESTINATION,
      principalPropagation: config.ppEnabled,
    },
  };
}

function sanitizeUrl(raw: string): string {
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.username = url.username ? '[REDACTED]' : '';
    url.password = url.password ? '[REDACTED]' : '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return raw.replace(/\/\/[^/@]+:[^/@]+@/, '//[REDACTED]@');
  }
}
