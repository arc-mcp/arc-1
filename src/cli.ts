/**
 * ARC-1 command-line interface.
 *
 * Direct calls reuse the MCP dispatcher, validation, safety policy, audit
 * pipeline, startup authentication check, and target-local feature evidence.
 */

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Command, CommanderError, Option } from 'commander';
import { config as loadDotEnv } from 'dotenv';
import { appendAunitJunitDiagnostic, parseNativeJunitSummary } from './adt/aunit.js';
import { AdtClient } from './adt/client.js';
import type { AdtClientConfig } from './adt/config.js';
import type { AtcRunResult } from './adt/devtools.js';
import type { CachingLayer } from './cache/caching-layer.js';
import { buildArgs, type OutputMode } from './cli-args.js';
import {
  type AunitCiResult,
  assertAtcPriority,
  assertPercent,
  atcToCheckstyle,
  evaluateAtc,
  evaluateAunit,
  evaluateDiff,
  evaluateLint,
  formatAtcText,
  formatAunitText,
  formatLintText,
  type LintFailureThreshold,
  lintToCheckstyle,
  type StructuredDiffResult,
} from './cli-checks.js';
import { getToolRegistry, handleToolCall } from './handlers/dispatch.js';
import { setCachedDiscovery, setCachedFeatures } from './handlers/feature-cache.js';
import { errorResult, type ToolResult } from './handlers/shared.js';
import type { LintResult } from './lint/lint.js';
import { sanitizeArgs } from './server/audit.js';
import { assertNoRemovedCliFlags, CLI_CONFIG_OPTION_SPECS, resolveConfig } from './server/config.js';
import { generateRequestId } from './server/context.js';
import { initLogger, logger } from './server/logger.js';
import { loadPlugins } from './server/plugin-loader.js';
import {
  buildAdtConfig,
  createCachingLayer,
  formatStartupAuthPreflightToolError,
  getConfiguredToolDefinitions,
  probeClientFeatures,
  runStartupAuthPreflightWithClient,
  VERSION,
} from './server/server.js';
import { FileSink } from './server/sinks/file.js';
import type { ConfigSource, ServerConfig } from './server/types.js';

loadDotEnv({ quiet: true });

export type CliExitCode = 0 | 1 | 2 | 3;

type ResolvedConfig = ReturnType<typeof resolveConfig>;

export interface CliDependencies {
  resolveConfiguration?: typeof resolveConfig;
  createClient?: (config: Partial<AdtClientConfig>) => AdtClient;
  createCache?: (config: ServerConfig) => Promise<CachingLayer | undefined>;
  dispatchToolCall?: typeof handleToolCall;
  probeFeatures?: typeof probeClientFeatures;
  authPreflight?: typeof runStartupAuthPreflightWithClient;
  startServer?: (config: ServerConfig, sources: Record<string, ConfigSource>) => Promise<unknown>;
  flushLogger?: () => Promise<void>;
  runCookieExtractor?: (args: string[]) => Promise<void>;
}

export interface CreateCliProgramOptions {
  argv?: readonly string[];
  dependencies?: CliDependencies;
  /** Internal execution state. Supplying it is useful for focused tests. */
  state?: CliExecutionState;
}

export interface CliExecutionState {
  exitCode: CliExitCode;
  /** Successful `serve` keeps logger sinks alive for the long-running process. */
  longLivedServerStarted?: boolean;
}

interface DirectContext {
  client: AdtClient;
  cachingLayer?: CachingLayer;
}

interface RuntimeState extends CliExecutionState {
  resolvedConfig?: ResolvedConfig;
  directContext?: Promise<DirectContext>;
  pluginsLoaded?: Promise<void>;
}

export type CliToolCallOutcome =
  | { kind: 'tool'; result: ToolResult }
  | { kind: 'usage'; message: string; knownTools?: string[] };

export interface CliRuntime {
  state: CliExecutionState;
  deps: Required<CliDependencies>;
  getResolvedConfig: () => ResolvedConfig;
  getDirectContext: () => Promise<DirectContext>;
  loadConfiguredPlugins: (config: ServerConfig) => Promise<void>;
  dispose: () => Promise<void>;
}

interface UnitTestCommandOptions {
  coverage?: boolean;
  includeSubpackages?: boolean;
  minStatement?: string;
  minBranch?: string;
  minProcedure?: string;
  format: 'text' | 'json' | 'junit';
  reportFile?: string;
  allowEmpty?: boolean;
  failOnSkipped?: boolean;
  timeout?: string;
}

interface AtcCommandOptions {
  variant?: string;
  maxPriority: string;
  format: 'text' | 'json' | 'checkstyle';
  reportFile?: string;
  timeout?: string;
}

interface LintCommandOptions {
  format: 'text' | 'json' | 'checkstyle';
  reportFile?: string;
  failOn: LintFailureThreshold;
}

interface DiffCommandOptions {
  from: string;
  to: string;
  fromLabel?: string;
  toLabel?: string;
  include?: string;
  group?: string;
  check?: boolean;
  failOnDiff?: boolean;
  format: 'text' | 'json';
  reportFile?: string;
}

const defaultDependencies: Required<CliDependencies> = {
  resolveConfiguration: resolveConfig,
  createClient: (config) => new AdtClient(config),
  createCache: createCachingLayer,
  dispatchToolCall: handleToolCall,
  probeFeatures: probeClientFeatures,
  authPreflight: runStartupAuthPreflightWithClient,
  startServer: async (config, sources) => {
    const { createAndStartServer } = await import('./server/server.js');
    await createAndStartServer(config, sources);
  },
  flushLogger: () => logger.flush(),
  runCookieExtractor: async (args) => {
    const { run } = await import('./extract-sap-cookies.js');
    await run(args);
  },
};

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function addOutputOption(command: Command): Command {
  return command.addOption(new Option('--output <mode>', 'Output mode').choices(['text', 'json']).default('text'));
}

function configArgv(argv: readonly string[]): string[] {
  const separator = argv.indexOf('--');
  return [...(separator < 0 ? argv : argv.slice(0, separator))];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function renderToolResult(result: ToolResult, mode: OutputMode): CliExitCode {
  if (mode === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const stream = result.isError ? console.error : console.log;
    for (const block of result.content) {
      if (block.type === 'text') stream(block.text);
    }
  }
  return result.isError ? 1 : 0;
}

type CiJsonOutcome<T> = { ok: true; value: T } | { ok: false };

function parseCiToolResult<T>(result: ToolResult): T {
  const text = result.content.find((entry) => entry.type === 'text' && typeof entry.text === 'string')?.text;
  if (!text) throw new Error('Tool returned no text result for the CI command.');
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Tool returned a non-JSON CI result: ${errorMessage(error)}`);
  }
}

async function executeCiJson<T>(
  runtime: CliRuntime,
  toolName: string,
  args: Record<string, unknown>,
  options?: { localOnly?: boolean },
): Promise<CiJsonOutcome<T>> {
  const outcome = await executeCliToolCall(runtime, toolName, args, options);
  if (outcome.kind === 'usage') {
    console.error(outcome.message);
    if (outcome.knownTools) console.error(`Known tools: ${outcome.knownTools.join(', ')}`);
    runtime.state.exitCode = 2;
    return { ok: false };
  }
  if (outcome.result.isError) {
    runtime.state.exitCode = renderToolResult(outcome.result, 'text');
    return { ok: false };
  }
  try {
    return { ok: true, value: parseCiToolResult<T>(outcome.result) };
  } catch (error) {
    console.error(errorMessage(error));
    runtime.state.exitCode = 1;
    return { ok: false };
  }
}

async function emitCiReport(content: string, reportFile: string | undefined): Promise<boolean> {
  try {
    if (reportFile && reportFile !== '-') {
      await writeFile(reportFile, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
    } else console.log(content);
    return true;
  } catch (error) {
    console.error(`Could not write CI report: ${errorMessage(error)}`);
    return false;
  }
}

function representAunitExitInJunit(junit: string, exitCode: 1 | 3): string {
  const summary = parseNativeJunitSummary(junit);
  if (summary.failures > 0 || summary.errors > 0) return junit;
  const incomplete = exitCode === 3;
  return appendAunitJunitDiagnostic(
    junit,
    summary,
    incomplete ? 'incomplete' : 'failed',
    incomplete
      ? 'ARC-1 could not evaluate a complete ABAP Unit CI result.'
      : 'ARC-1 ABAP Unit CI policy failed although SAP reported no failing test case.',
  );
}

function formatConfigSource(source: ConfigSource | undefined): string {
  if (source === undefined || source === 'default') return 'default';
  if (typeof source === 'object') {
    if ('env' in source) return `env ${source.env}`;
    if ('flag' in source) return `flag ${source.flag}`;
    if ('file' in source) return `file ${source.file}`;
  }
  return 'unknown';
}

function directModeError(config: ServerConfig): string | undefined {
  const sapUrl = config.url.trim();
  if (!sapUrl) return 'Direct CLI calls require SAP_URL to be configured.';
  try {
    const parsed = new URL(sapUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol');
  } catch {
    return 'Direct CLI calls require SAP_URL to be a valid HTTP(S) URL.';
  }
  if (config.multiTargetEndpoints) {
    return 'Direct CLI calls do not support ARC1_MULTI_TARGET_ENDPOINTS. Use the MCP server endpoint for multi-target routing.';
  }
  if (config.ppEnabled) {
    return 'Direct CLI calls do not support principal propagation. Use the MCP HTTP server so the caller JWT can be propagated.';
  }
  if (
    config.btpServiceKey ||
    config.btpServiceKeyFile ||
    process.env.SAP_BTP_DESTINATION ||
    process.env.SAP_BTP_PP_DESTINATION
  ) {
    return (
      'Direct CLI calls currently support a single SAP_URL target with Basic or cookie authentication only. ' +
      'BTP service-key and Destination Service bootstrap is available through the MCP server.'
    );
  }
  return undefined;
}

function shouldSkipFeatureProbe(toolName: string, args: Record<string, unknown>): boolean {
  return toolName === 'SAPManage' && String(args.action ?? '').toLowerCase() === 'probe';
}

function isLocalOnlyCall(toolName: string, args: Record<string, unknown>): boolean {
  const action = String(args.action ?? '').toLowerCase();
  return (toolName === 'SAPManage' && action === 'cache_stats') || (toolName === 'SAPLint' && action === 'list_rules');
}

function isDisabledWriteTool(toolName: string, config: ServerConfig): boolean {
  return !config.allowWrites && (toolName === 'SAPWrite' || toolName === 'SAPActivate');
}

function auditBlockedDirectPreflight(
  config: ServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  startedAt: number,
): void {
  const requestId = generateRequestId();
  const pluginName = getToolRegistry().get(toolName)?.pluginName;
  logger.emitAudit({
    timestamp: new Date(startedAt).toISOString(),
    level: 'info',
    event: 'tool_call_start',
    destination: config.destinationName,
    requestId,
    tool: toolName,
    pluginName,
    args: sanitizeArgs(args),
  });
  logger.emitAudit({
    timestamp: new Date().toISOString(),
    level: 'error',
    event: 'tool_call_end',
    destination: config.destinationName,
    requestId,
    tool: toolName,
    pluginName,
    durationMs: Date.now() - startedAt,
    status: 'error',
    errorClass: 'StartupAuthPreflightError',
    errorMessage:
      'Shared SAP authentication preflight blocked this direct CLI call (HTTP authentication/authorization response details suppressed).',
  });
}

function createRuntime(argv: readonly string[], state: CliExecutionState, overrides: CliDependencies): CliRuntime {
  const runtimeState = state as RuntimeState;
  const deps = { ...defaultDependencies, ...overrides };

  const getResolvedConfig = (): ResolvedConfig => {
    if (!runtimeState.resolvedConfig) {
      runtimeState.resolvedConfig = deps.resolveConfiguration(configArgv(argv));
      const serverConfig = runtimeState.resolvedConfig.config;
      initLogger(serverConfig.logFormat, serverConfig.verbose);
    }
    return runtimeState.resolvedConfig;
  };

  const getDirectContext = (): Promise<DirectContext> => {
    runtimeState.directContext ??= (async () => {
      const { config } = getResolvedConfig();
      if (config.logFile) {
        logger.addSink(new FileSink(config.logFile));
      }
      const client = deps.createClient(buildAdtConfig(config) as AdtClientConfig);
      const cachingLayer = await deps.createCache(config);
      return { client, cachingLayer };
    })();
    return runtimeState.directContext;
  };

  const loadConfiguredPlugins = async (config: ServerConfig): Promise<void> => {
    if (!runtimeState.pluginsLoaded) {
      runtimeState.pluginsLoaded = config.plugins?.length
        ? loadPlugins(config.plugins, getToolRegistry()).then(() => undefined)
        : Promise.resolve();
    }
    await runtimeState.pluginsLoaded;
  };

  const dispose = async (): Promise<void> => {
    if (!runtimeState.directContext) return;
    try {
      const context = await runtimeState.directContext;
      context.cachingLayer?.cache.close();
    } catch {
      // Context construction failed, so there is no successfully opened cache to close.
    }
  };

  return { state: runtimeState, deps, getResolvedConfig, getDirectContext, loadConfiguredPlugins, dispose };
}

/** Build a fresh Commander program. Importing this module never parses argv or exits. */
export function createCliProgram(options: CreateCliProgramOptions = {}): Command {
  const argv = options.argv ?? [];
  const executionState = options.state ?? { exitCode: 0 };
  const runtime = createRuntime(argv, executionState, options.dependencies ?? {});
  const program = new Command();

  program
    .name('arc1')
    .description('ARC-1 — MCP Server and CLI for SAP ABAP Systems')
    .version(VERSION)
    .exitOverride()
    .allowUnknownOption(false)
    .allowExcessArguments(false);

  for (const spec of CLI_CONFIG_OPTION_SPECS) {
    const value = spec.valueOptional ? `[${spec.valueName}]` : `<${spec.valueName}>`;
    program.addOption(new Option(`--${spec.name} ${value}`, spec.description));
  }

  program
    .command('serve', { isDefault: true })
    .description('Start the MCP server (default when no subcommand is supplied)')
    .allowUnknownOption(false)
    .allowExcessArguments(false)
    .action(async () => {
      const { config, sources } = runtime.getResolvedConfig();
      await runtime.deps.startServer(config, sources);
      runtime.state.longLivedServerStarted = true;
    });

  addOutputOption(
    program
      .command('call <tool>')
      .description('Call an MCP tool directly')
      .option('--arg <key=value>', 'Tool argument; repeatable', collect, [])
      .option('--json <source>', 'JSON args: inline object, file path, or "-" for stdin'),
  ).action(async (tool: string, opts: { arg: string[]; json?: string; output: OutputMode }) => {
    const args = buildArgs(opts);
    runtime.state.exitCode = await runToolCall(runtime, tool, args, opts.output);
  });

  program
    .command('tools [tool]')
    .description("List advertised MCP tools, or show one tool's JSON input schema")
    .action(async (tool: string | undefined) => {
      const { config } = runtime.getResolvedConfig();
      await runtime.loadConfiguredPlugins(config);
      const pluginDefs = getToolRegistry()
        .list()
        .flatMap((entry) =>
          entry.source === 'plugin' && entry.listing
            ? [
                {
                  name: entry.name,
                  description: entry.listing.description,
                  inputSchema: entry.listing.inputSchema,
                },
              ]
            : [],
        );
      const definitions = [...getConfiguredToolDefinitions(config), ...pluginDefs];
      if (!tool) {
        for (const definition of definitions) {
          console.log(`${definition.name.padEnd(14)} ${definition.description.split('\n')[0].trim()}`);
        }
        return;
      }
      const match = definitions.find((definition) => definition.name.toLowerCase() === tool.toLowerCase());
      if (!match) {
        console.error(`Unknown or non-advertised tool: ${tool}`);
        console.error(`Advertised tools: ${definitions.map((definition) => definition.name).join(', ')}`);
        runtime.state.exitCode = 2;
        return;
      }
      console.log(match.description);
      console.log('\nInput schema:');
      console.log(JSON.stringify(match.inputSchema, null, 2));
    });

  addOutputOption(
    program
      .command('read <type> <name>')
      .description('Read an ABAP object via SAPRead')
      .option('--flat', 'Return flat source for CLAS/INTF')
      .option('--source-version <version>', 'Source version: active, inactive, or auto'),
  ).action(async (type: string, name: string, opts: { flat?: boolean; sourceVersion?: string; output: OutputMode }) => {
    const args: Record<string, unknown> = { type: type.toUpperCase(), name };
    if (opts.flat) args.format = 'text';
    if (opts.sourceVersion) args.version = opts.sourceVersion;
    runtime.state.exitCode = await runToolCall(runtime, 'SAPRead', args, opts.output);
  });

  addOutputOption(program.command('source <type> <name>').description('Alias of `read --flat` (legacy)')).action(
    async (type: string, name: string, opts: { output: OutputMode }) => {
      runtime.state.exitCode = await runToolCall(
        runtime,
        'SAPRead',
        { type: type.toUpperCase(), name, format: 'text' },
        opts.output,
      );
    },
  );

  addOutputOption(program.command('activate <type> <name>').description('Activate an ADT object')).action(
    async (type: string, name: string, opts: { output: OutputMode }) => {
      runtime.state.exitCode = await runToolCall(
        runtime,
        'SAPActivate',
        { action: 'activate', type: type.toUpperCase(), name },
        opts.output,
      );
    },
  );

  addOutputOption(program.command('syntax <type> <name>').description('Run a remote syntax check')).action(
    async (type: string, name: string, opts: { output: OutputMode }) => {
      runtime.state.exitCode = await runToolCall(
        runtime,
        'SAPDiagnose',
        { action: 'syntax', type: type.toUpperCase(), name },
        opts.output,
      );
    },
  );

  addOutputOption(program.command('sql <query>').description('Execute an OpenSQL query through SAPQuery')).action(
    async (query: string, opts: { output: OutputMode }) => {
      runtime.state.exitCode = await runToolCall(runtime, 'SAPQuery', { sql: query }, opts.output);
    },
  );

  addOutputOption(
    program
      .command('search <query>')
      .description('Search for ABAP objects')
      .option('--max <number>', 'Maximum results', '50'),
  ).action(async (query: string, opts: { max: string; output: OutputMode }) => {
    runtime.state.exitCode = await runToolCall(
      runtime,
      'SAPSearch',
      { query, maxResults: Number(opts.max) },
      opts.output,
    );
  });

  program
    .command('unittest <type> <name>')
    .description('Run harmless-only ABAP Unit tests for an object or DEVC package')
    .option('--coverage', 'Collect statement, branch, and procedure coverage')
    .option('--include-subpackages', 'For DEVC only, include the complete package subtree')
    .option('--min-statement <percent>', 'Minimum statement coverage percentage')
    .option('--min-branch <percent>', 'Minimum branch coverage percentage')
    .option('--min-procedure <percent>', 'Minimum procedure coverage percentage')
    .addOption(new Option('--format <format>', 'Report format').choices(['text', 'json', 'junit']).default('text'))
    .option('--report-file <path>', 'Write the report to a file; use "-" for stdout')
    .option('--timeout <seconds>', 'End-to-end ABAP Unit evidence budget (1-3600 seconds; default 300)')
    .option('--allow-empty', 'Allow only a sound no-tests result to pass')
    .option('--fail-on-skipped', 'Fail when any executed method is skipped')
    .action(async (type: string, name: string, opts: UnitTestCommandOptions) => {
      const normalizedType = type.toUpperCase();
      if (opts.includeSubpackages === true && normalizedType !== 'DEVC') {
        console.error('--include-subpackages is only valid when unittest type is DEVC.');
        runtime.state.exitCode = 2;
        return;
      }
      const coverage = {
        ...(opts.minStatement !== undefined ? { statement: assertPercent(opts.minStatement, '--min-statement') } : {}),
        ...(opts.minBranch !== undefined ? { branch: assertPercent(opts.minBranch, '--min-branch') } : {}),
        ...(opts.minProcedure !== undefined ? { procedure: assertPercent(opts.minProcedure, '--min-procedure') } : {}),
      };
      const coverageRequested = opts.coverage === true || Object.keys(coverage).length > 0;
      const timeoutSeconds = opts.timeout === undefined ? undefined : Number(opts.timeout);
      if (
        timeoutSeconds !== undefined &&
        (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600)
      ) {
        console.error('--timeout must be an integer from 1 to 3600 seconds.');
        runtime.state.exitCode = 2;
        return;
      }
      const outcome = await executeCiJson<AunitCiResult>(runtime, 'SAPDiagnose', {
        action: 'unittest',
        type: normalizedType,
        name,
        coverage: coverageRequested,
        ...(opts.includeSubpackages === true ? { includeSubpackages: true } : {}),
        ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
        resultFormat: opts.format === 'junit' ? 'junit' : 'structured',
      });
      if (!outcome.ok) return;

      const exitCode = evaluateAunit(outcome.value, {
        allowEmpty: opts.allowEmpty,
        failOnSkipped: opts.failOnSkipped,
        requireCoverage: opts.coverage === true,
        coverage,
      });
      let report: string | undefined;
      try {
        report =
          opts.format === 'json'
            ? JSON.stringify(outcome.value, null, 2)
            : opts.format === 'junit'
              ? outcome.value.junit
              : formatAunitText(outcome.value);
        if (opts.format === 'junit' && report && exitCode !== 0) {
          report = representAunitExitInJunit(report, exitCode);
        }
      } catch {
        console.error('ABAP Unit returned malformed or incomplete structured evidence; no report was emitted.');
        runtime.state.exitCode = exitCode === 3 ? 3 : 1;
        return;
      }
      if (typeof report !== 'string' || !report) {
        console.error(
          exitCode === 3
            ? 'ABAP Unit returned malformed or incomplete structured evidence; no report was emitted.'
            : 'ABAP Unit did not return the requested JUnit report.',
        );
        runtime.state.exitCode = exitCode === 3 ? 3 : 1;
        return;
      }
      if (!(await emitCiReport(report, opts.reportFile))) {
        runtime.state.exitCode = 1;
        return;
      }
      runtime.state.exitCode = exitCode;
    });

  program
    .command('atc <type> <name>')
    .description('Run ATC with completeness evidence and CI thresholds')
    .option('--variant <name>', 'ATC check variant; omit for the system default')
    .option('--timeout <seconds>', 'ATC execution and verification budget (1-3600 seconds; default 300)')
    .option('--max-priority <priority>', 'Fail on findings with priority <= N (1=error, 2=warning, 3=info)', '1')
    .addOption(new Option('--format <format>', 'Report format').choices(['text', 'json', 'checkstyle']).default('text'))
    .option('--report-file <path>', 'Write the report to a file; use "-" for stdout')
    .action(async (type: string, name: string, opts: AtcCommandOptions) => {
      const maxPriority = assertAtcPriority(opts.maxPriority);
      const timeoutSeconds = opts.timeout === undefined ? undefined : Number(opts.timeout);
      if (
        timeoutSeconds !== undefined &&
        (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600)
      ) {
        console.error('--timeout must be an integer from 1 to 3600 seconds.');
        runtime.state.exitCode = 2;
        return;
      }
      const outcome = await executeCiJson<AtcRunResult>(runtime, 'SAPDiagnose', {
        action: 'atc',
        type: type.toUpperCase(),
        name,
        ...(opts.variant ? { variant: opts.variant } : {}),
        ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
        resultFormat: 'structured',
      });
      if (!outcome.ok) return;
      const exitCode = evaluateAtc(outcome.value, maxPriority);
      if (exitCode === 3) {
        const reasons = Array.isArray(outcome.value.incompleteReasons)
          ? outcome.value.incompleteReasons.filter((reason): reason is string => typeof reason === 'string')
          : [];
        console.error(
          reasons.length > 0
            ? `ATC returned incomplete evidence: ${reasons.join(' ')}`
            : 'ATC returned malformed or incomplete structured evidence; no report was emitted.',
        );
        runtime.state.exitCode = exitCode;
        return;
      }
      const report =
        opts.format === 'json'
          ? JSON.stringify(outcome.value, null, 2)
          : opts.format === 'checkstyle'
            ? atcToCheckstyle(outcome.value)
            : formatAtcText(outcome.value);
      if (!(await emitCiReport(report, opts.reportFile))) {
        runtime.state.exitCode = 1;
        return;
      }
      runtime.state.exitCode = exitCode;
    });

  program
    .command('diff <type> <name>')
    .description('Compare two SAP source versions with optional CI failure on differences')
    .option('--from <version>', 'Old side: active, inactive, revision id, or revision URI', 'active')
    .option('--to <version>', 'New side: active, inactive, revision id, or revision URI', 'inactive')
    .option('--from-label <label>', 'Display label for the old side')
    .option('--to-label <label>', 'Display label for the new side')
    .option('--include <include>', 'Class include to compare')
    .option('--group <group>', 'Function group for FUNC revisions')
    .option('--check', 'Exit 1 when differences exist')
    .option('--fail-on-diff', 'Alias for --check')
    .addOption(new Option('--format <format>', 'Report format').choices(['text', 'json']).default('text'))
    .option('--report-file <path>', 'Write the report to a file; use "-" for stdout')
    .action(async (type: string, name: string, opts: DiffCommandOptions) => {
      const outcome = await executeCiJson<StructuredDiffResult>(runtime, 'SAPRead', {
        action: 'diff',
        type: type.toUpperCase(),
        name,
        from: opts.from,
        to: opts.to,
        format: 'structured',
        ...(opts.fromLabel ? { fromLabel: opts.fromLabel } : {}),
        ...(opts.toLabel ? { toLabel: opts.toLabel } : {}),
        ...(opts.include ? { include: opts.include } : {}),
        ...(opts.group ? { group: opts.group } : {}),
      });
      if (!outcome.ok) return;
      const exitCode = evaluateDiff(outcome.value, opts.check === true || opts.failOnDiff === true);
      if (exitCode === 3) {
        console.error('SAPRead diff returned malformed or incomplete structured evidence; no report was emitted.');
        runtime.state.exitCode = exitCode;
        return;
      }
      const report =
        opts.format === 'json'
          ? JSON.stringify(outcome.value, null, 2)
          : outcome.value.identical
            ? `No differences between ${outcome.value.fromLabel} and ${outcome.value.toLabel} for ${outcome.value.type} ${outcome.value.name}.`
            : `Diff ${outcome.value.type} ${outcome.value.name}: ${outcome.value.fromLabel} → ${outcome.value.toLabel}  (+${outcome.value.added} -${outcome.value.removed})\n\n${outcome.value.diff}`;
      if (!(await emitCiReport(report, opts.reportFile))) {
        runtime.state.exitCode = 1;
        return;
      }
      runtime.state.exitCode = exitCode;
    });

  program
    .command('extract-cookies [args...]')
    .description('Launch a browser and write a Netscape SAP cookie file')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(async () => {
      const index = argv.indexOf('extract-cookies');
      const forwarded = index < 0 ? [] : [...argv.slice(index + 1)];
      try {
        await runtime.deps.runCookieExtractor(forwarded);
      } catch (err) {
        process.stderr.write(`${errorMessage(err)}\n`);
        runtime.state.exitCode = 1;
      }
    });

  program
    .command('lint <file>')
    .description('Lint a local ABAP source file with CI reports')
    .addOption(new Option('--format <format>', 'Report format').choices(['text', 'json', 'checkstyle']).default('text'))
    .option('--report-file <path>', 'Write the report to a file; use "-" for stdout')
    .addOption(
      new Option('--fail-on <severity>', 'Failure threshold')
        .choices(['error', 'warning', 'info', 'none'])
        .default('error'),
    )
    .action(async (file: string, opts: LintCommandOptions) => {
      const source = readFileSync(file, 'utf-8');
      const outcome = await executeCiJson<LintResult[]>(
        runtime,
        'SAPLint',
        {
          action: 'lint',
          source,
          name: file.replace(/\.abap$/, ''),
        },
        { localOnly: true },
      );
      if (!outcome.ok) return;
      const lintExitCode = evaluateLint(outcome.value, opts.failOn);
      if (lintExitCode === 3) {
        console.error('SAPLint returned malformed or incomplete structured evidence; no report was emitted.');
        runtime.state.exitCode = 3;
        return;
      }
      const report =
        opts.format === 'json'
          ? JSON.stringify(outcome.value, null, 2)
          : opts.format === 'checkstyle'
            ? lintToCheckstyle(outcome.value, file)
            : formatLintText(outcome.value);
      if (!(await emitCiReport(report, opts.reportFile))) {
        runtime.state.exitCode = 1;
        return;
      }
      runtime.state.exitCode = lintExitCode;
    });

  program
    .command('version')
    .description('Show ARC-1 version')
    .action(() => console.log(`ARC-1 v${VERSION}`));

  const configCommand = program.command('config').description('Configuration inspection');
  configCommand
    .command('show')
    .description('Show the resolved effective safety policy with source attribution')
    .addOption(new Option('--format <format>', 'Output format').choices(['table', 'json']).default('table'))
    .action((opts: { format: 'table' | 'json' }) => {
      const { config, sources } = runtime.getResolvedConfig();
      if (opts.format === 'json') {
        console.log(
          JSON.stringify(
            {
              effectivePolicy: {
                allowWrites: config.allowWrites,
                allowDataPreview: config.allowDataPreview,
                allowFreeSQL: config.allowFreeSQL,
                allowTransportWrites: config.allowTransportWrites,
                allowGitWrites: config.allowGitWrites,
                allowedPackages: config.allowedPackages,
                allowedTransports: config.allowedTransports,
                denyActions: config.denyActions,
              },
              sources,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log('ARC-1 effective authorization policy');
      console.log('────────────────────────────────────');
      const fields = [
        ['allowWrites', config.allowWrites],
        ['allowDataPreview', config.allowDataPreview],
        ['allowFreeSQL', config.allowFreeSQL],
        ['allowTransportWrites', config.allowTransportWrites],
        ['allowGitWrites', config.allowGitWrites],
        ['allowedPackages', JSON.stringify(config.allowedPackages)],
        ['allowedTransports', JSON.stringify(config.allowedTransports)],
      ] as const;
      for (const [name, value] of fields) {
        console.log(`  ${name.padEnd(22)} = ${String(value).padEnd(30)} [${formatConfigSource(sources[name])}]`);
      }
      console.log('\nDeny actions:');
      if (config.denyActions.length === 0) {
        console.log(`  (none) [${formatConfigSource(sources.denyActions)}]`);
      } else {
        for (const pattern of config.denyActions) {
          console.log(`  ${pattern} [${formatConfigSource(sources.denyActions)}]`);
        }
      }
    });

  Object.defineProperty(program, '__arc1Dispose', { value: runtime.dispose });
  Object.defineProperty(program, '__arc1Flush', { value: runtime.deps.flushLogger });
  return program;
}

/**
 * Execute a configured direct tool call and return the unrendered MCP result.
 * Dedicated CI commands reuse this to apply domain-specific exit/report policy
 * while retaining the normal dispatcher, validation, safety, and audit path.
 */
export async function executeCliToolCall(
  runtime: CliRuntime,
  toolName: string,
  args: Record<string, unknown>,
  options: { localOnly?: boolean } = {},
): Promise<CliToolCallOutcome> {
  const { config } = runtime.getResolvedConfig();
  const localOnly = options.localOnly === true || isLocalOnlyCall(toolName, args);
  await runtime.loadConfiguredPlugins(config);

  if (!getToolRegistry().get(toolName)) {
    return {
      kind: 'usage',
      message: `Unknown tool: ${toolName}`,
      knownTools: getToolRegistry()
        .list()
        .map((entry) => entry.name),
    };
  }

  if (!localOnly) {
    const unsupported = directModeError(config);
    if (unsupported) return { kind: 'usage', message: unsupported };
  }

  const direct = await runtime.getDirectContext();
  if (!localOnly && !isDisabledWriteTool(toolName, config)) {
    const preflightStartedAt = Date.now();
    const preflight = await runtime.deps.authPreflight(config, direct.client);
    if (preflight.blocking) {
      auditBlockedDirectPreflight(config, toolName, args, preflightStartedAt);
      return { kind: 'tool', result: errorResult(formatStartupAuthPreflightToolError(preflight)) };
    }

    if (config.url && !shouldSkipFeatureProbe(toolName, args)) {
      try {
        await runtime.deps.probeFeatures(config, direct.client);
      } catch (err) {
        const featureKey = config.targetId ?? config.destinationName;
        const emptyDiscovery = new Map<string, string[]>();
        setCachedFeatures(undefined, featureKey);
        setCachedDiscovery(emptyDiscovery, featureKey);
        direct.client.http.setDiscoveryMap(emptyDiscovery);
        logger.debug('Direct CLI feature probe failed; continuing with unknown feature evidence', {
          error: errorMessage(err),
        });
      }
    }
  }

  try {
    const result = await runtime.deps.dispatchToolCall(
      direct.client,
      config,
      toolName,
      args,
      undefined,
      undefined,
      direct.cachingLayer,
    );
    return { kind: 'tool', result };
  } catch (err) {
    return { kind: 'tool', result: errorResult(errorMessage(err)) };
  }
}

async function runToolCall(
  runtime: CliRuntime,
  toolName: string,
  args: Record<string, unknown>,
  outputMode: OutputMode,
): Promise<CliExitCode> {
  const outcome = await executeCliToolCall(runtime, toolName, args);
  if (outcome.kind === 'usage') {
    console.error(outcome.message);
    if (outcome.knownTools) console.error(`Known tools: ${outcome.knownTools.join(', ')}`);
    return 2;
  }
  return renderToolResult(outcome.result, outputMode);
}

type CliProgramWithLifecycle = Command & {
  __arc1Dispose?: () => Promise<void>;
  __arc1Flush?: () => Promise<void>;
};

/** Parse one CLI invocation and return a deterministic process exit code. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: CliDependencies = {},
): Promise<number> {
  const state: CliExecutionState = { exitCode: 0 };
  const program = createCliProgram({ argv, dependencies, state }) as CliProgramWithLifecycle;
  try {
    assertNoRemovedCliFlags(configArgv(argv));
    await program.parseAsync([...argv], { from: 'user' });
    return state.exitCode;
  } catch (err) {
    if (err instanceof CommanderError) {
      return err.exitCode === 0 ? 0 : 2;
    }
    // Configuration/argument preparation failures are usage errors. Tool and
    // SAP failures are converted to ToolResult/exit 1 inside their action.
    console.error(errorMessage(err));
    return 2;
  } finally {
    await program.__arc1Dispose?.();
    if (!state.longLivedServerStarted) {
      await (program.__arc1Flush?.() ?? logger.flush());
    }
  }
}

// Keep `npm run cli -- ...` working without making imports execute a command.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
