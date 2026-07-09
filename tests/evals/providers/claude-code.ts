/**
 * Claude Code CLI provider — integration-level eval mode.
 *
 * Unlike the ollama/anthropic providers, this one doesn't implement a
 * single-turn `chat()` loop. Instead, it spawns `claude -p` per scenario
 * with ARC-1 registered as an *stdio* MCP server and lets Claude Code run
 * its own agentic loop. We parse the stream-json output to extract tool
 * calls and score only the ARC-1 ones (native Read/Grep/Bash are real-world
 * noise — they don't help or hurt the score).
 *
 * This mirrors how a developer actually uses ARC-1: Claude Code with its
 * full native toolset + ARC-1 as one MCP server among others. It's the
 * closest thing to production we can eval without shipping.
 *
 * Requirements:
 *   - `claude` CLI installed (https://claude.com/claude-code)
 *   - ANTHROPIC_API_KEY in env (claude -p bills to API, not subscription)
 *   - ARC-1 source checked out in cwd (we spawn it via tsx)
 *   - SAP_* credentials in env (ARC-1 needs them to serve live requests)
 *
 * Tool names under Claude Code:
 *   mcp__arc1__SAPRead, mcp__arc1__SAPContext, etc.
 *   We strip the `mcp__arc1__` prefix before matching against scenario
 *   expectations (which are written in terms of bare tool names).
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  matchesExpectedToolCall as matches,
  scoreExpectedToolCallParameters as paramScore,
  scenarioPasses,
} from '../expected-call.js';
import type { EvalScenario, LLMToolCall, ScenarioScore } from '../types.js';

export const DEFAULT_CLAUDE_CODE_MODEL = 'claude-haiku-4-5-20251001';

/** MCP server name registered in the throwaway .mcp.json — becomes the tool prefix. */
const MCP_SERVER_NAME = 'arc1';
const TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/** Native tools we allow alongside MCP — matches a realistic coding session. */
const ALLOWED_NATIVE_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];

export interface ClaudeCodeRunOptions {
  /** Claude model to use. Default: claude-haiku-4-5-20251001. */
  model?: string;
  /** Absolute path to ARC-1 repo root (for tsx spawn). Defaults to process.cwd(). */
  repoRoot?: string;
  /** Max ms to wait for the claude process. */
  timeoutMs?: number;
}

/** Environment variables forwarded from our test env to the spawned ARC-1 MCP server. */
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

/** Build the `.mcp.json` payload that registers ARC-1 as an stdio server. */
function buildMcpConfig(repoRoot: string): Record<string, unknown> {
  // Prefer TEST_SAP_* if set (same convention as integration tests), fall back to SAP_*.
  const resolveSap = (testKey: string, fallbackKey: string): string | undefined =>
    process.env[testKey] ?? process.env[fallbackKey];

  const env: Record<string, string> = {};
  // Promote TEST_SAP_* → SAP_* for the child so the server picks them up.
  const mappings: Array<[string, string]> = [
    ['TEST_SAP_URL', 'SAP_URL'],
    ['TEST_SAP_USER', 'SAP_USER'],
    ['TEST_SAP_PASSWORD', 'SAP_PASSWORD'],
    ['TEST_SAP_CLIENT', 'SAP_CLIENT'],
  ];
  for (const [testKey, sapKey] of mappings) {
    const v = resolveSap(testKey, sapKey);
    if (v !== undefined) env[sapKey] = v;
  }
  // Pass through anything else already present.
  for (const k of SAP_ENV_KEYS) {
    if (process.env[k] !== undefined && env[k] === undefined) {
      env[k] = process.env[k] as string;
    }
  }

  // Prefer built dist/ over `npx tsx` — tsx cold-start adds 2-5s, and Claude
  // Code doesn't block its first response on a still-pending MCP server. If
  // dist is missing we fall back to tsx and warn the caller.
  const distEntry = join(repoRoot, 'dist/index.js');
  const useDist = existsSync(distEntry);
  const command = useDist ? 'node' : 'npx';
  const args = useDist ? [distEntry] : ['tsx', join(repoRoot, 'src/index.ts')];
  if (!useDist) {
    console.warn(
      `  [eval:claude-code] dist/ missing — falling back to tsx (slow startup may cause MCP to miss the first turn). Run \`npm run build\` first.`,
    );
  }

  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command,
        args,
        env,
      },
    },
  };
}

/** Write throwaway .mcp.json and return its absolute path. */
function writeMcpConfig(repoRoot: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'arc1-eval-'));
  const path = join(dir, 'mcp-eval.json');
  writeFileSync(path, JSON.stringify(buildMcpConfig(repoRoot), null, 2));
  return path;
}

/**
 * Strip the `mcp__arc1__` prefix so ARC-1 tool calls match scenario
 * expectations that are written in bare form (`SAPRead`, `SAPContext`, …).
 */
function normalizeToolCall(name: string, input: Record<string, unknown>): LLMToolCall | null {
  if (!name.startsWith(TOOL_PREFIX)) return null;
  return {
    name: name.slice(TOOL_PREFIX.length),
    arguments: input ?? {},
  };
}

/**
 * Parse one JSON line from `claude -p --output-format stream-json`.
 * The stream includes `system`, `assistant`, `user`, `result` events; we
 * only care about `assistant` messages that contain `tool_use` blocks.
 */
function extractToolCallsFromStreamLine(line: string): LLMToolCall[] {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return [];
  }
  if (event.type !== 'assistant') return [];
  const message = event.message as { content?: Array<Record<string, unknown>> } | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return [];

  const calls: LLMToolCall[] = [];
  for (const block of content) {
    if (block.type !== 'tool_use') continue;
    const normalized = normalizeToolCall((block.name as string) ?? '', (block.input as Record<string, unknown>) ?? {});
    if (normalized) calls.push(normalized);
  }
  return calls;
}

/** Extract usage + duration from the final `result` event. */
interface ClaudeRunResult {
  arcToolCalls: LLMToolCall[];
  totalTokens: number;
  durationMs: number;
  rawTrace: string;
  exitCode: number;
}

async function spawnClaude(
  prompt: string,
  mcpConfigPath: string,
  model: string,
  timeoutMs: number,
): Promise<ClaudeRunResult> {
  const args = [
    '-p',
    prompt,
    '--bare', // no hooks, memory, CLAUDE.md auto-discovery
    '--model',
    model,
    '--mcp-config',
    mcpConfigPath,
    '--strict-mcp-config', // only our throwaway config; ignore user/project .mcp.json
    '--output-format',
    'stream-json',
    '--verbose', // stream-json requires --verbose in non-interactive mode
    '--no-session-persistence',
    '--permission-mode',
    'bypassPermissions', // headless; we control the MCP surface
    '--allowedTools',
    [...ALLOWED_NATIVE_TOOLS, `mcp__${MCP_SERVER_NAME}`].join(','),
  ];

  return new Promise<ClaudeRunResult>((resolvePromise, rejectPromise) => {
    const start = Date.now();
    const child = spawn('claude', args, {
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
      rejectPromise(new Error(`claude -p timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      let idx = stdoutBuf.indexOf('\n');
      while (idx !== -1) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (line.trim().length > 0) {
          rawLines.push(line);
          calls.push(...extractToolCallsFromStreamLine(line));

          // Capture usage from the terminal "result" event.
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'result' && evt.usage) {
              const input = Number(evt.usage.input_tokens ?? 0);
              const output = Number(evt.usage.output_tokens ?? 0);
              totalTokens = input + output;
            }
          } catch {
            // non-JSON line or malformed — ignore, we only care about well-formed events
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
      rejectPromise(new Error(`Failed to spawn claude CLI: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      if (code !== 0 && calls.length === 0) {
        const hint =
          code === 127 ? 'claude CLI not found on PATH. Install from https://claude.com/claude-code.' : `exit=${code}`;
        const stderrTail = stderrBuf.split('\n').slice(-10).join('\n');
        rejectPromise(new Error(`claude -p failed (${hint}).\nstderr:\n${stderrTail}`));
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

/**
 * Run a scenario against Claude Code CLI.
 *
 * Scoring differs from the chat-loop providers: we only look at the
 * ARC-1 tool calls in the trace. Native tools (Read, Grep, …) are
 * considered real-world noise and neither help nor hurt. This means
 * `forbidden` and `optimal` checks operate on ARC-1 calls only.
 */
export async function runScenarioWithClaudeCode(
  scenario: EvalScenario,
  options: ClaudeCodeRunOptions & { passThreshold: number },
): Promise<ScenarioScore> {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const model = options.model ?? DEFAULT_CLAUDE_CODE_MODEL;
  const timeoutMs = options.timeoutMs ?? 150_000;

  const mcpConfigPath = writeMcpConfig(repoRoot);
  const start = Date.now();
  let run: ClaudeRunResult;
  try {
    run = await spawnClaude(scenario.prompt, mcpConfigPath, model, timeoutMs);
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
      explanation: `claude -p error: ${message}`,
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
 * Scoring tailored to the integration model:
 *   - If the LLM never called any ARC-1 tool → 0 (it ignored the MCP server).
 *   - First ARC-1 call must not be a forbidden tool.
 *   - Match against optimal / acceptable by tool name + required args.
 *   - Parameter score follows harness.ts conventions (case-insensitive for strings).
 */
function scoreArcCalls(
  arcCalls: LLMToolCall[],
  scenario: EvalScenario,
): { toolSelectionScore: number; parameterScore: number; explanation: string } {
  if (arcCalls.length === 0) {
    return {
      toolSelectionScore: 0,
      parameterScore: 0,
      explanation: 'No ARC-1 MCP tools were called (LLM used only native tools or gave up).',
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
        explanation: `Correct tool ${first.name} but params partial: ${JSON.stringify(first.arguments)}`,
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

/** Probe that the `claude` binary exists and ANTHROPIC_API_KEY is set. */
export async function checkClaudeCodeAvailable(): Promise<{ available: boolean; reason?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      available: false,
      reason: 'ANTHROPIC_API_KEY not set (claude -p bills to API, not subscription)',
    };
  }

  const ok = await new Promise<boolean>((res) => {
    const child = spawn('claude', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', () => res(false));
    child.on('close', (code) => res(code === 0));
  });
  if (!ok) {
    return {
      available: false,
      reason: 'claude CLI not found on PATH. Install from https://claude.com/claude-code',
    };
  }

  return { available: true };
}
