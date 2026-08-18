import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { type CliDependencies, main } from '../../../src/cli.js';
import { CLI_CONFIG_OPTION_SPECS, type resolveConfig } from '../../../src/server/config.js';
import { logger } from '../../../src/server/logger.js';
import type { StartupAuthPreflightResult } from '../../../src/server/server.js';
import type { ServerConfig } from '../../../src/server/types.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

function resolved(overrides: Partial<ServerConfig> = {}): ReturnType<typeof resolveConfig> {
  return { config: { ...DEFAULT_CONFIG, cacheMode: 'none', ...overrides }, sources: {} };
}

function fakeClient(): AdtClient {
  return {
    http: { setDiscoveryMap: vi.fn() },
  } as unknown as AdtClient;
}

function successfulToolResult(text = 'ok') {
  return { content: [{ type: 'text' as const, text }] };
}

function successfulAuthPreflight(): StartupAuthPreflightResult {
  return {
    status: 'ok',
    blocking: false,
    endpoint: '/sap/bc/adt/core/discovery',
    checkedAt: '2026-08-17T00:00:00.000Z',
    reason: 'ok',
  };
}

function directDependencies(
  config: ReturnType<typeof resolveConfig>,
  overrides: CliDependencies = {},
): CliDependencies {
  return {
    resolveConfiguration: vi.fn(() => config),
    createClient: vi.fn(() => fakeClient()),
    createCache: vi.fn(async () => undefined),
    authPreflight: vi.fn(async () => successfulAuthPreflight()),
    probeFeatures: vi.fn(async () => undefined),
    dispatchToolCall: vi.fn(async () => successfulToolResult()),
    flushLogger: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('CLI runtime', () => {
  it('keeps commandless, root-option-only startup compatible', async () => {
    const startServer = vi.fn(async () => undefined);
    const flushLogger = vi.fn(async () => undefined);
    const resolveConfiguration = vi.fn((argv: string[]) => {
      expect(argv).toEqual(['--url', 'https://sap.example.test', '--client', '001']);
      return resolved({ url: 'https://sap.example.test', client: '001' });
    });

    const code = await main(['--url', 'https://sap.example.test', '--client', '001'], {
      resolveConfiguration,
      startServer,
      flushLogger,
    });

    expect(code).toBe(0);
    expect(resolveConfiguration).toHaveBeenCalledOnce();
    expect(startServer).toHaveBeenCalledOnce();
    expect(flushLogger).not.toHaveBeenCalled();
  });

  it('flushes logger sinks when server startup fails before becoming long-lived', async () => {
    const flushLogger = vi.fn(async () => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await main(['serve'], {
      resolveConfiguration: vi.fn(() => resolved()),
      startServer: vi.fn(async () => {
        throw new Error('startup failed');
      }),
      flushLogger,
    });

    expect(code).toBe(2);
    expect(flushLogger).toHaveBeenCalledOnce();
  });

  it.each([
    ['before', ['--abap-release', '758', 'call', 'SAPLint', '--json', '{"action":"list_rules"}']],
    ['after', ['call', 'SAPLint', '--json', '{"action":"list_rules"}', '--abap-release', '758']],
  ])('accepts registered root config options %s a subcommand and resolves config once', async (_label, argv) => {
    const dependencies = directDependencies(resolved({ url: 'https://sap.example.test', abapRelease: '758' }));

    const code = await main(argv, dependencies);

    expect(code).toBe(0);
    expect(dependencies.resolveConfiguration).toHaveBeenCalledOnce();
    expect(dependencies.dispatchToolCall).toHaveBeenCalledOnce();
  });

  it('rejects a misspelled command without entering default serve', async () => {
    const startServer = vi.fn(async () => undefined);
    const resolveConfiguration = vi.fn(() => resolved());
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await main(['versoin'], {
      resolveConfiguration,
      startServer,
      flushLogger: vi.fn(async () => undefined),
    });

    expect(code).toBe(2);
    expect(resolveConfiguration).not.toHaveBeenCalled();
    expect(startServer).not.toHaveBeenCalled();
  });

  it('rejects an unknown option as usage without resolving SAP configuration', async () => {
    const resolveConfiguration = vi.fn(() => resolved());
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await main(['version', '--urll', 'https://sap.example.test'], {
      resolveConfiguration,
      flushLogger: vi.fn(async () => undefined),
    });

    expect(code).toBe(2);
    expect(resolveConfiguration).not.toHaveBeenCalled();
  });

  it.each([
    ['legacy', '--read-only', 'SAP_ALLOW_WRITES'],
    ['retired', '--cache-warmup', 'Cache warmup was removed'],
  ])('reports an actionable %s flag migration before strict option parsing', async (_kind, flag, guidance) => {
    const resolveConfiguration = vi.fn(() => resolved());
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await main(['version', flag], {
      resolveConfiguration,
      flushLogger: vi.fn(async () => undefined),
    });

    expect(code).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(guidance));
    expect(resolveConfiguration).not.toHaveBeenCalled();
  });

  it('does not resolve invalid SAP configuration for help or version', async () => {
    const resolveConfiguration = vi.fn(() => {
      throw new Error('must not resolve');
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    expect(await main(['--help'], { resolveConfiguration, flushLogger: vi.fn(async () => undefined) })).toBe(0);
    expect(await main(['--version'], { resolveConfiguration, flushLogger: vi.fn(async () => undefined) })).toBe(0);
    expect(resolveConfiguration).not.toHaveBeenCalled();
  });

  it('rejects an unknown tool before client construction or SAP I/O', async () => {
    const dependencies = directDependencies(resolved());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await main(['call', 'NotATool'], dependencies);

    expect(code).toBe(2);
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(dependencies.authPreflight).not.toHaveBeenCalled();
    expect(dependencies.probeFeatures).not.toHaveBeenCalled();
  });

  it('sends known hidden write tools to the dispatcher instead of reporting Unknown tool', async () => {
    const dispatchToolCall = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'Writes are disabled by SAP_ALLOW_WRITES=false' }],
      isError: true,
    }));
    const dependencies = directDependencies(resolved({ allowWrites: false, url: 'https://sap.example.test' }), {
      dispatchToolCall,
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await main(
      ['call', 'SAPWrite', '--json', '{"action":"create","type":"PROG","name":"Z_TEST","source":"REPORT z_test."}'],
      dependencies,
    );

    expect(code).toBe(1);
    expect(dispatchToolCall).toHaveBeenCalledOnce();
    expect(dependencies.authPreflight).not.toHaveBeenCalled();
    expect(dependencies.probeFeatures).not.toHaveBeenCalled();
  });

  it('classifies a missing SAP_URL as configuration usage even when the write tool is disabled', async () => {
    const dependencies = directDependencies(resolved({ allowWrites: false, url: '' }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await main(['activate', 'PROG', 'Z_TEST'], dependencies)).toBe(2);
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(dependencies.dispatchToolCall).not.toHaveBeenCalled();
  });

  it('uses one client in auth -> feature probe -> dispatcher order', async () => {
    const client = fakeClient();
    const order: string[] = [];
    const dependencies = directDependencies(resolved({ url: 'https://sap.example.test' }), {
      createClient: vi.fn(() => client),
      authPreflight: vi.fn(async (_config, received) => {
        expect(received).toBe(client);
        order.push('auth');
        return successfulAuthPreflight();
      }),
      probeFeatures: vi.fn(async (_config, received) => {
        expect(received).toBe(client);
        order.push('probe');
      }),
      dispatchToolCall: vi.fn(async (received) => {
        expect(received).toBe(client);
        order.push('dispatch');
        return successfulToolResult();
      }),
    });

    expect(await main(['call', 'SAPRead', '--json', '{"type":"SYSTEM"}'], dependencies)).toBe(0);
    expect(order).toEqual(['auth', 'probe', 'dispatch']);
  });

  it('keeps local lint offline even when a SAP URL is configured', async () => {
    const dependencies = directDependencies(resolved({ url: 'https://sap.example.test' }), {
      dispatchToolCall: vi.fn(async () => successfulToolResult('[]')),
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(await main(['lint', 'tests/fixtures/abap/zarc1_test_report.abap'], dependencies)).toBe(0);
    expect(dependencies.authPreflight).not.toHaveBeenCalled();
    expect(dependencies.probeFeatures).not.toHaveBeenCalled();
    expect(dependencies.dispatchToolCall).toHaveBeenCalledOnce();
  });

  it('keeps generic SAPLint calls on the live bootstrap path for release parity', async () => {
    const dependencies = directDependencies(resolved({ url: 'https://sap.example.test' }), {
      dispatchToolCall: vi.fn(async () => successfulToolResult('[]')),
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(await main(['call', 'SAPLint', '--json', '{"action":"lint","source":"REPORT ztest."}'], dependencies)).toBe(
      0,
    );
    expect(dependencies.authPreflight).toHaveBeenCalledOnce();
    expect(dependencies.probeFeatures).toHaveBeenCalledOnce();
    expect(dependencies.dispatchToolCall).toHaveBeenCalledOnce();
  });

  it('keeps the local SAPLint rule catalog available without a SAP target', async () => {
    const dependencies = directDependencies(resolved({ url: '' }));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(await main(['call', 'SAPLint', '--json', '{"action":"list_rules"}'], dependencies)).toBe(0);
    expect(dependencies.authPreflight).not.toHaveBeenCalled();
    expect(dependencies.probeFeatures).not.toHaveBeenCalled();
    expect(dependencies.dispatchToolCall).toHaveBeenCalledOnce();
  });

  it('stops on blocking auth failure before probe fan-out and dispatch', async () => {
    const dependencies = directDependencies(resolved({ url: 'https://sap.example.test' }), {
      authPreflight: vi.fn(
        async (): Promise<StartupAuthPreflightResult> => ({
          status: 'failed',
          blocking: true,
          endpoint: '/sap/bc/adt/core/discovery',
          checkedAt: '2026-08-17T00:00:00.000Z',
          statusCode: 401,
          reason: 'bad credentials',
        }),
      ),
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await main(['call', 'SAPRead', '--json', '{"type":"SYSTEM"}'], dependencies);

    expect(code).toBe(1);
    expect(dependencies.probeFeatures).not.toHaveBeenCalled();
    expect(dependencies.dispatchToolCall).not.toHaveBeenCalled();
  });

  it('persists one redacted start/end audit pair when direct auth preflight blocks', async () => {
    const auditDir = mkdtempSync(join(tmpdir(), 'arc1-cli-preflight-audit-'));
    const auditFile = join(auditDir, 'audit.jsonl');
    const argPassword = 'argument-password-sentinel';
    const nestedToken = 'nested-token-sentinel';
    const urlPassword = 'url-password-sentinel';
    const responseDetail = 'response-detail-sentinel';
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const dependencies = directDependencies(
        resolved({ url: 'https://sap.example.test', logFile: auditFile, logFormat: 'json' }),
        {
          authPreflight: vi.fn(
            async (): Promise<StartupAuthPreflightResult> => ({
              status: 'failed',
              blocking: true,
              endpoint: '/sap/bc/adt/core/discovery',
              checkedAt: '2026-08-17T00:00:00.000Z',
              statusCode: 401,
              reason: responseDetail,
            }),
          ),
          flushLogger: () => logger.flush(),
        },
      );
      const rawArgs = {
        type: 'SYSTEM',
        password: argPassword,
        nested: { token: nestedToken },
        url: `https://user:${urlPassword}@example.test/path?token=query-secret`,
      };

      expect(await main(['call', 'SAPRead', '--json', JSON.stringify(rawArgs)], dependencies)).toBe(1);
      expect(dependencies.probeFeatures).not.toHaveBeenCalled();
      expect(dependencies.dispatchToolCall).not.toHaveBeenCalled();

      const events = readFileSync(auditFile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(events).toHaveLength(2);
      const [start, end] = events;
      expect(start).toMatchObject({ event: 'tool_call_start', tool: 'SAPRead' });
      expect(end).toMatchObject({
        event: 'tool_call_end',
        tool: 'SAPRead',
        status: 'error',
        errorClass: 'StartupAuthPreflightError',
      });
      expect(start.requestId).toEqual(expect.any(String));
      expect(end.requestId).toBe(start.requestId);
      expect(end.durationMs).toEqual(expect.any(Number));

      const startArgs = start.args as Record<string, unknown>;
      expect(startArgs.password).toBe('[REDACTED]');
      expect((startArgs.nested as Record<string, unknown>).token).toBe('[REDACTED]');
      const serialized = JSON.stringify(events);
      for (const sentinel of [argPassword, nestedToken, urlPassword, responseDetail, 'query-secret']) {
        expect(serialized).not.toContain(sentinel);
      }
      expect(String(end.errorMessage)).toMatch(/^\[REDACTED \d+ chars\]$/);

      const stderrText = stderr.join('');
      expect(stderrText.match(/"event":"tool_call_start"/g)).toHaveLength(1);
      expect(stderrText.match(/"event":"tool_call_end"/g)).toHaveLength(1);
      expect(stderrText).not.toContain(argPassword);
      expect(stderrText).not.toContain(nestedToken);
      expect(stderrText).not.toContain(urlPassword);
      expect(stderrText).not.toContain(responseDetail);
    } finally {
      rmSync(auditDir, { recursive: true, force: true });
    }
  });

  it('leaves successful direct-call audit ownership to the dispatcher', async () => {
    const auditDir = mkdtempSync(join(tmpdir(), 'arc1-cli-success-audit-'));
    const auditFile = join(auditDir, 'audit.jsonl');
    try {
      const dependencies = directDependencies(
        resolved({ url: 'https://sap.example.test', logFile: auditFile, logFormat: 'json' }),
        { flushLogger: () => logger.flush() },
      );

      expect(await main(['call', 'SAPRead', '--json', '{"type":"SYSTEM"}'], dependencies)).toBe(0);
      expect(dependencies.dispatchToolCall).toHaveBeenCalledOnce();
      expect(existsSync(auditFile)).toBe(false);
    } finally {
      rmSync(auditDir, { recursive: true, force: true });
    }
  });

  it('continues with empty same-client discovery evidence after a non-auth probe failure', async () => {
    const client = fakeClient();
    const dispatchToolCall = vi.fn(async () => successfulToolResult());
    const dependencies = directDependencies(resolved({ url: 'https://sap.example.test' }), {
      createClient: vi.fn(() => client),
      probeFeatures: vi.fn(async () => {
        throw new Error('probe unavailable');
      }),
      dispatchToolCall,
    });

    expect(await main(['call', 'SAPRead', '--json', '{"type":"SYSTEM"}'], dependencies)).toBe(0);
    expect(client.http.setDiscoveryMap).toHaveBeenCalledWith(new Map());
    expect(dispatchToolCall).toHaveBeenCalledOnce();
  });

  it('fails clearly instead of treating BTP service-key mode as direct Basic auth', async () => {
    const dependencies = directDependencies(resolved({ btpServiceKeyFile: '/tmp/key.json' }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await main(['call', 'SAPRead', '--json', '{"type":"SYSTEM"}'], dependencies);

    expect(code).toBe(2);
    expect(dependencies.authPreflight).not.toHaveBeenCalled();
    expect(dependencies.dispatchToolCall).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', ''],
    ['invalid', 'not a URL'],
    ['unsupported protocol', 'ftp://sap.example.test'],
  ])('classifies a %s SAP_URL as a configuration error', async (_label, url) => {
    const dependencies = directDependencies(resolved({ url }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const code = await main(['read', 'CLAS', 'ZCL_TEST'], dependencies);

    expect(code).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('SAP_URL'));
    expect(dependencies.authPreflight).not.toHaveBeenCalled();
    expect(dependencies.dispatchToolCall).not.toHaveBeenCalled();
  });

  it('flushes logger sinks before returning', async () => {
    const flushLogger = vi.fn(async () => undefined);

    expect(await main(['version'], { flushLogger })).toBe(0);
    expect(flushLogger).toHaveBeenCalledOnce();
  });
});

describe('configuration option registration invariant', () => {
  it('registers every flag requested by resolveConfig', () => {
    const source = readFileSync(new URL('../../../src/server/config.ts', import.meta.url), 'utf8');
    const requested = new Set(
      [
        ...source.matchAll(
          /(?:getFlag|getOptionalFlagValue|resolveStr|resolveBool|resolveFeature|resolveOptionalStr)\(\s*'([^']+)'/g,
        ),
      ].map((match) => match[1]),
    );
    const registered = new Set(CLI_CONFIG_OPTION_SPECS.map((spec) => spec.name));

    expect(registered).toEqual(requested);
  });
});

describe('CLI subprocess entry', () => {
  it('runs the source entry explicitly and returns strict exit codes', () => {
    const version = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'version'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(version.status).toBe(0);
    expect(version.stdout).toMatch(/^ARC-1 v\d+\.\d+\.\d+/);

    const typo = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'versoin'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(typo.status).toBe(2);
    expect(typo.stderr).toContain('too many arguments');
  });
});
