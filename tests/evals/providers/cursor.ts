/**
 * Cursor CLI provider — integration-level eval mode via the Cursor subscription.
 *
 * Same shape as claude-code.ts: spawn the CLI per scenario with ARC-1 registered
 * as an stdio MCP server, parse the stream-json trace, score only ARC-1 tool
 * calls. Differences from Claude Code:
 *
 *   - No `--mcp-config` flag. Cursor reads `<cwd>/.cursor/mcp.json` (merged
 *     with the user's `~/.cursor/mcp.json`). We run in a mkdtemp'd cwd and
 *     write `.cursor/mcp.json` there so we don't touch the user's real repo.
 *   - No `--strict-mcp-config`. The user's global MCPs are visible. We don't
 *     try to hide them — native/other tools are realistic noise for this eval.
 *   - No separate `--allowedTools`. `--force` allows all bash/tool calls.
 *   - Event shape: `{"type":"tool_call","subtype":"started","tool_call":
 *     {"mcpToolCall":{"args":{"toolName":"SAPContext","args":{...},
 *     "providerIdentifier":"arc1"}}}}`. We read `toolName` + `args` directly
 *     (already bare — no prefix to strip).
 *   - Usage field is camelCase (`inputTokens`/`outputTokens`) vs Claude's
 *     snake_case.
 *
 * Approval gotcha: newly-defined MCP servers are "not loaded (needs approval)"
 * on first run. `--force` pre-approves tool USE but not server REGISTRATION.
 * If the user already has an approved ARC-1 server in `~/.cursor/mcp.json`
 * (e.g. `arc1`, `arc1-dev`), Cursor will route to it — we match on `toolName`
 * regardless of `providerIdentifier` to stay server-name-agnostic.
 *
 * Requirements:
 *   - `cursor-agent` CLI installed (https://cursor.com/cli)
 *   - `cursor-agent login` completed (uses subscription, no API key)
 *   - An approved ARC-1 MCP server in Cursor (either ours on first approval,
 *     or an existing one in your global `.cursor/mcp.json`)
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  matchesExpectedToolCall as matches,
  scoreExpectedToolCallParameters as paramScore,
  scenarioPasses,
} from '../expected-call.js';
import type { EvalScenario, LLMToolCall, ScenarioScore } from '../types.js';

/**
 * Cursor default. `cursor-agent --help` hardcodes `sonnet-4` in examples but
 * the actual accepted list is dynamic and versioned — `sonnet-4` was retired
 * in favor of `claude-4.5-sonnet`. If you see "Cannot use this model", pass
 * `--model <valid-id>` explicitly or update this constant. Run `cursor-agent
 * -p "hi" --model xxx` to see the current valid list on your subscription.
 */
export const DEFAULT_CURSOR_MODEL = 'claude-4.5-sonnet';

/** Tools we score. Anything outside this set is ignored as realistic noise. */
const ARC1_TOOL_NAMES = new Set([
  'SAPRead',
  'SAPSearch',
  'SAPWrite',
  'SAPActivate',
  'SAPNavigate',
  'SAPQuery',
  'SAPLint',
  'SAPDiagnose',
  'SAPContext',
  'SAPManage',
  'SAPTransport',
]);

export interface CursorRunOptions {
  model?: string;
  repoRoot?: string;
  timeoutMs?: number;
}

const SAP_ENV_KEYS = [
  'SAP_URL',
  'SAP_USER',
  'SAP_PASSWORD',
  'SAP_CLIENT',
  'SAP_LANGUAGE',
  'SAP_INSECURE',
  'SAP_SYSTEM_TYPE',
  'SAP_ABAP_RELEASE',
  'SAP_ALLOW_WRITES',
  'SAP_ALLOW_FREE_SQL',
  'SAP_ALLOW_DATA_PREVIEW',
  'SAP_ALLOWED_PACKAGES',
  'SAP_ALLOW_TRANSPORT_WRITES',
  'SAP_ALLOW_GIT_WRITES',
  'SAP_DENY_ACTIONS',
  'TEST_SAP_URL',
  'TEST_SAP_USER',
  'TEST_SAP_PASSWORD',
  'TEST_SAP_CLIENT',
];

/**
 * Build the `.cursor/mcp.json` payload. Uses built `dist/index.js` when
 * available (instant startup) and falls back to `npx tsx` with a warning.
 */
function buildMcpConfig(repoRoot: string): { config: Record<string, unknown>; useDist: boolean } {
  const env: Record<string, string> = {};
  const mappings: Array<[string, string]> = [
    ['TEST_SAP_URL', 'SAP_URL'],
    ['TEST_SAP_USER', 'SAP_USER'],
    ['TEST_SAP_PASSWORD', 'SAP_PASSWORD'],
    ['TEST_SAP_CLIENT', 'SAP_CLIENT'],
  ];
  for (const [testKey, sapKey] of mappings) {
    const v = process.env[testKey] ?? process.env[sapKey];
    if (v !== undefined) env[sapKey] = v;
  }
  for (const k of SAP_ENV_KEYS) {
    if (process.env[k] !== undefined && env[k] === undefined) {
      env[k] = process.env[k] as string;
    }
  }

  const distEntry = join(repoRoot, 'dist/index.js');
  const useDist = existsSync(distEntry);
  const command = useDist ? 'node' : 'npx';
  const args = useDist ? [distEntry] : ['tsx', join(repoRoot, 'src/index.ts')];

  return {
    useDist,
    config: {
      mcpServers: {
        arc1: {
          command,
          args,
          env,
        },
      },
    },
  };
}

/** Set up a tempdir with `.cursor/mcp.json` and return the cwd. */
function prepareCwd(repoRoot: string): { cwd: string; useDist: boolean } {
  const cwd = mkdtempSync(join(tmpdir(), 'arc1-cursor-eval-'));
  mkdirSync(join(cwd, '.cursor'), { recursive: true });
  const { config, useDist } = buildMcpConfig(repoRoot);
  writeFileSync(join(cwd, '.cursor/mcp.json'), JSON.stringify(config, null, 2));
  return { cwd, useDist };
}

/**
 * Extract ARC-1 tool calls from one stream-json line.
 * Cursor emits BOTH `started` and `completed` events for every call — we only
 * count the `started` ones to avoid double-counting.
 */
function extractToolCalls(line: string): LLMToolCall[] {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return [];
  }

  if (event.type !== 'tool_call') return [];
  if ((event as { subtype?: string }).subtype !== 'started') return [];

  const toolCall = (event as { tool_call?: { mcpToolCall?: { args?: Record<string, unknown> } } }).tool_call;
  const mcp = toolCall?.mcpToolCall?.args;
  if (!mcp) return [];

  const toolName = mcp.toolName as string | undefined;
  const args = (mcp.args as Record<string, unknown> | undefined) ?? {};
  if (!toolName || !ARC1_TOOL_NAMES.has(toolName)) return [];

  return [{ name: toolName, arguments: args }];
}

interface CursorRunResult {
  arcToolCalls: LLMToolCall[];
  totalTokens: number;
  durationMs: number;
  rawTrace: string;
  exitCode: number;
}

async function spawnCursor(prompt: string, cwd: string, model: string, timeoutMs: number): Promise<CursorRunResult> {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--force', '--model', model];

  return new Promise<CursorRunResult>((resolvePromise, rejectPromise) => {
    const start = Date.now();
    const child = spawn('cursor-agent', args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const calls: LLMToolCall[] = [];
    let totalTokens = 0;
    let stdoutBuf = '';
    let stderrBuf = '';
    const rawLines: string[] = [];

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      rejectPromise(new Error(`cursor-agent timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      let idx = stdoutBuf.indexOf('\n');
      while (idx !== -1) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (line.trim().length > 0) {
          rawLines.push(line);
          calls.push(...extractToolCalls(line));

          try {
            const evt = JSON.parse(line);
            if (evt.type === 'result' && evt.usage) {
              const inputTokens = Number(evt.usage.inputTokens ?? 0);
              const outputTokens = Number(evt.usage.outputTokens ?? 0);
              totalTokens = inputTokens + outputTokens;
            }
          } catch {
            // non-JSON line — ignore
          }
        }
        idx = stdoutBuf.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      rejectPromise(new Error(`Failed to spawn cursor-agent: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      if (code !== 0 && calls.length === 0) {
        const hint =
          code === 127 ? 'cursor-agent not found on PATH. Install from https://cursor.com/cli' : `exit=${code}`;
        const stderrTail = stderrBuf.split('\n').slice(-10).join('\n');
        rejectPromise(new Error(`cursor-agent failed (${hint}).\nstderr:\n${stderrTail}`));
        return;
      }
      resolvePromise({
        arcToolCalls: calls,
        totalTokens,
        durationMs,
        rawTrace: rawLines.join('\n'),
        exitCode: code ?? 0,
      });
    });
  });
}

export async function runScenarioWithCursor(
  scenario: EvalScenario,
  options: CursorRunOptions & { passThreshold: number },
): Promise<ScenarioScore> {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const model = options.model ?? DEFAULT_CURSOR_MODEL;
  // Cursor's first turn includes MCP server startup + first real SAP call.
  // Observed 60-90s in manual probes on A4H — give a wider margin.
  const timeoutMs = options.timeoutMs ?? 240_000;

  const { cwd, useDist } = prepareCwd(repoRoot);
  if (!useDist) {
    console.warn(
      '  [eval:cursor] dist/ missing — falling back to tsx (slow startup may cause MCP to miss the first turn). Run `npm run build` first.',
    );
  }

  const start = Date.now();
  let run: CursorRunResult;
  try {
    run = await spawnCursor(scenario.prompt, cwd, model, timeoutMs);
    if (run.arcToolCalls.length === 0 && process.env.EVAL_DEBUG) {
      console.error(`\n[eval:debug] ${scenario.id} — no ARC-1 tool calls. Raw stream:\n${run.rawTrace}\n`);
    }
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return {
      scenarioId: scenario.id,
      toolSelectionScore: 0,
      parameterScore: 0,
      overallScore: 0,
      toolCallCount: 0,
      trace: [],
      durationMs,
      explanation: `cursor-agent error: ${message}`,
      passed: false,
    };
  }

  const arcCalls = run.arcToolCalls;
  const { toolSelectionScore, parameterScore, explanation } = scoreArcCalls(arcCalls, scenario);
  const overallScore = toolSelectionScore * 0.6 + parameterScore * 0.4;

  return {
    scenarioId: scenario.id,
    toolSelectionScore,
    parameterScore,
    overallScore,
    toolCallCount: arcCalls.length,
    trace: arcCalls,
    totalTokens: run.totalTokens,
    durationMs: run.durationMs,
    explanation,
    passed: scenarioPasses(scenario, overallScore, parameterScore, options.passThreshold),
  };
}

/**
 * Scoring mirrors claude-code.ts — only ARC-1 calls count, first call against
 * forbidden/optimal/acceptable.
 */
function scoreArcCalls(
  arcCalls: LLMToolCall[],
  scenario: EvalScenario,
): { toolSelectionScore: number; parameterScore: number; explanation: string } {
  if (arcCalls.length === 0) {
    return {
      toolSelectionScore: 0,
      parameterScore: 0,
      explanation: 'No ARC-1 MCP tools were called (Cursor used native tools only, or MCP not approved).',
    };
  }

  const first = arcCalls[0];

  if (scenario.forbidden?.includes(first.name)) {
    return {
      toolSelectionScore: 0,
      parameterScore: 0,
      explanation: `Called forbidden ARC-1 tool first: ${first.name}`,
    };
  }

  for (const expected of scenario.optimal) {
    if (matches(first, expected)) {
      return {
        toolSelectionScore: 1.0,
        parameterScore: paramScore(first, expected),
        explanation: `Optimal: ${first.name}(${JSON.stringify(first.arguments)})`,
      };
    }
  }
  for (const expected of scenario.optimal) {
    if (first.name === expected.tool) {
      return {
        toolSelectionScore: 1.0,
        parameterScore: paramScore(first, expected),
        explanation: `Correct tool ${first.name} but params partial`,
      };
    }
  }
  if (scenario.acceptable) {
    for (const expected of scenario.acceptable) {
      if (matches(first, expected)) {
        return {
          toolSelectionScore: 0.5,
          parameterScore: paramScore(first, expected),
          explanation: `Acceptable: ${first.name}(${JSON.stringify(first.arguments)})`,
        };
      }
    }
    for (const expected of scenario.acceptable) {
      if (first.name === expected.tool) {
        return {
          toolSelectionScore: 0.5,
          parameterScore: paramScore(first, expected),
          explanation: `Acceptable tool ${first.name} but params partial`,
        };
      }
    }
  }

  return {
    toolSelectionScore: 0,
    parameterScore: 0,
    explanation: `Wrong ARC-1 tool: ${first.name}(${JSON.stringify(first.arguments)}). Expected: ${scenario.optimal.map((e) => e.tool).join(' or ')}`,
  };
}

/** Verify cursor-agent exists and the user is logged in. */
export async function checkCursorAvailable(): Promise<{ available: boolean; reason?: string }> {
  const exists = await new Promise<boolean>((res) => {
    const child = spawn('cursor-agent', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', () => res(false));
    child.on('close', (code) => res(code === 0));
  });
  if (!exists) {
    return {
      available: false,
      reason: 'cursor-agent not found on PATH. Install from https://cursor.com/cli',
    };
  }
  return { available: true };
}
