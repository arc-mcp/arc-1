/**
 * LLM Eval Test Suite
 *
 * Tests whether LLMs correctly select and parameterize ARC-1 MCP tools.
 * Scenarios live under `tests/evals/scenarios/<feature>.ts` and are
 * aggregated by `scenarios/index.ts`. See `tests/evals/README.md` for the
 * full filter matrix and the rules for adding a new scenario.
 *
 * All configuration is read from environment (loaded from `.env` on startup).
 *
 * Filtering (precedence: high → low):
 *   EVAL_SCENARIO=<id>        — single scenario by id (most specific)
 *   EVAL_FILE=<name>[,<name>] — feature bucket(s); name matches key in SCENARIO_FILES
 *   EVAL_TAG=<tag>[,<tag>]    — scenarios with ANY of the listed tags
 *   EVAL_CATEGORY=<category>  — legacy category filter
 *
 * Backend:
 *   EVAL_BACKEND=mock (default) — scenario.mockResponses feed the LLM
 *   EVAL_BACKEND=live           — real MCP server at EVAL_MCP_URL (default
 *                                 http://localhost:3000/mcp). Fails hard if
 *                                 the server is unreachable.
 *
 * Provider:
 *   EVAL_PROVIDER=ollama (default) | anthropic
 *   EVAL_MODEL=<model-id>        (default: qwen3.5:9b for ollama,
 *                                 claude-haiku-4-5-20251001 for anthropic)
 *   OLLAMA_BASE_URL=<url>        (default: http://localhost:11434)
 *   ANTHROPIC_API_KEY=<key>      (required for anthropic provider)
 *
 * Scoring:
 *   EVAL_PASS_THRESHOLD=0.5 (default)
 *
 * Results are printed to the console and persisted under
 *   test-results/evals/<ISO-timestamp>-<provider>-<model>-<backend>.json
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Priority (matches CLAUDE.md): CLI flags > real env vars > .env > defaults.
// An empty-string env var (e.g. accidental `export ANTHROPIC_API_KEY=""` in
// ~/.zshrc) counts as "unset" for our purposes — delete those before loading
// .env so the .env value fills them in correctly.
const EVAL_ENV_KEYS = ['ANTHROPIC_API_KEY', 'EVAL_PROVIDER', 'EVAL_MODEL', 'OLLAMA_BASE_URL'];
for (const k of EVAL_ENV_KEYS) {
  if (process.env[k] === '') delete process.env[k];
}
loadDotenv();

import { getToolDefinitions } from '../../src/handlers/tools.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { formatResults, runScenario, toOpenAITools } from './harness.js';
import { checkLiveBackendAvailable, connectLiveBackend, type LiveBackend } from './live-backend.js';
import { checkAnthropicAvailable, createAnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from './providers/anthropic.js';
import {
  checkClaudeCodeAvailable,
  DEFAULT_CLAUDE_CODE_MODEL,
  runScenarioWithClaudeCode,
} from './providers/claude-code.js';
import { checkCursorAvailable, DEFAULT_CURSOR_MODEL, runScenarioWithCursor } from './providers/cursor.js';
import { checkOllamaAvailable, createOllamaProvider, DEFAULT_OLLAMA_MODEL } from './providers/ollama.js';
import { ALL_SCENARIOS, FILE_OF_SCENARIO, SCENARIO_FILES } from './scenarios/index.js';
import type { EvalRunResult, EvalScenario, LLMProvider, ScenarioScore, ToolDefinitionForLLM } from './types.js';

// ─── Configuration ──────────────────────────────────────────────────

const PROVIDER_NAME = (process.env.EVAL_PROVIDER ?? 'claude-code').toLowerCase();
const SUPPORTED_PROVIDERS = new Set(['ollama', 'anthropic', 'claude-code', 'cursor']);
if (!SUPPORTED_PROVIDERS.has(PROVIDER_NAME)) {
  throw new Error(
    `Unknown EVAL_PROVIDER: "${PROVIDER_NAME}". Supported: "claude-code" (default), "cursor", "ollama", "anthropic".`,
  );
}
function defaultModelFor(provider: string): string {
  if (provider === 'ollama') return DEFAULT_OLLAMA_MODEL;
  if (provider === 'anthropic') return DEFAULT_ANTHROPIC_MODEL;
  if (provider === 'cursor') return DEFAULT_CURSOR_MODEL;
  return DEFAULT_CLAUDE_CODE_MODEL;
}
const MODEL = process.env.EVAL_MODEL ?? defaultModelFor(PROVIDER_NAME);

// Integration-level providers (claude-code, cursor) spawn ARC-1 as an stdio MCP
// server and always run "live". The mock/live distinction doesn't apply.
const IS_INTEGRATION_PROVIDER = PROVIDER_NAME === 'claude-code' || PROVIDER_NAME === 'cursor';
const BACKEND = IS_INTEGRATION_PROVIDER ? 'live' : (process.env.EVAL_BACKEND ?? 'mock').toLowerCase();
const SCENARIO_FILTER = process.env.EVAL_SCENARIO;
const FILE_FILTER = parseList(process.env.EVAL_FILE);
const TAG_FILTER = parseList(process.env.EVAL_TAG ?? process.env.EVAL_TAGS);
const CATEGORY_FILTER = process.env.EVAL_CATEGORY;
const PASS_THRESHOLD = Number(process.env.EVAL_PASS_THRESHOLD ?? '0.5');

function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function matchesFilters(scenario: EvalScenario): boolean {
  if (SCENARIO_FILTER && scenario.id !== SCENARIO_FILTER) return false;
  if (FILE_FILTER) {
    const file = FILE_OF_SCENARIO[scenario.id];
    if (!file || !FILE_FILTER.includes(file)) return false;
  }
  if (TAG_FILTER) {
    const tags = scenario.tags ?? [];
    if (!tags.some((tag) => TAG_FILTER.includes(tag))) return false;
  }
  if (CATEGORY_FILTER && scenario.category !== CATEGORY_FILTER) return false;
  return true;
}

// ─── Results Persistence ────────────────────────────────────────────

function persistResults(result: EvalRunResult): string | null {
  try {
    const timestamp = result.timestamp.replace(/[:.]/g, '-');
    const safeModel = MODEL.replace(/[^a-zA-Z0-9.-]/g, '_');
    const outPath = resolve(
      process.cwd(),
      `test-results/evals/${timestamp}-${PROVIDER_NAME}-${safeModel}-${BACKEND}.json`,
    );
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(result, null, 2));
    return outPath;
  } catch (err) {
    console.warn(`    [eval] Failed to persist results: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── Test Setup ─────────────────────────────────────────────────────

let provider: LLMProvider | undefined;
let tools: ToolDefinitionForLLM[];
let live: LiveBackend | undefined;
const allScores: ScenarioScore[] = [];

describe(`LLM Eval — ${PROVIDER_NAME}/${MODEL} [${BACKEND}]`, () => {
  beforeAll(async () => {
    // Provider setup — we intentionally throw (not skip) when the configured
    // provider is unavailable. A silent skip would hide a real misconfiguration
    // and turn the whole suite into a green pass-through.
    if (PROVIDER_NAME === 'ollama') {
      const check = await checkOllamaAvailable(MODEL);
      if (!check.available) {
        throw new Error(
          `Ollama is not reachable or model not installed: ${check.reason}\n` +
            '  Check OLLAMA_BASE_URL and EVAL_MODEL in .env, or start Ollama: `ollama serve`.',
        );
      }
      provider = createOllamaProvider(MODEL);
    } else if (PROVIDER_NAME === 'anthropic') {
      const check = checkAnthropicAvailable();
      if (!check.available) {
        throw new Error(`Anthropic provider unavailable: ${check.reason}\n  Add ANTHROPIC_API_KEY=sk-ant-... to .env.`);
      }
      provider = createAnthropicProvider(MODEL);
    } else if (PROVIDER_NAME === 'claude-code') {
      // claude-code — integration mode, no chat-loop provider object.
      const check = await checkClaudeCodeAvailable();
      if (!check.available) {
        throw new Error(
          `claude-code provider unavailable: ${check.reason}\n` +
            '  Install Claude Code CLI (https://claude.com/claude-code) and set ANTHROPIC_API_KEY.',
        );
      }
    } else {
      // cursor — integration mode via Cursor subscription.
      const check = await checkCursorAvailable();
      if (!check.available) {
        throw new Error(
          `cursor provider unavailable: ${check.reason}\n` +
            '  Install cursor-agent (https://cursor.com/cli) and run `cursor-agent login`.',
        );
      }
    }

    // Live backend only applies to ollama/anthropic — integration providers
    // handle their own stdio MCP wiring and never read this config.
    if (!IS_INTEGRATION_PROVIDER && BACKEND === 'live') {
      const check = await checkLiveBackendAvailable();
      if (!check.available) {
        throw new Error(
          `EVAL_BACKEND=live but MCP server unavailable: ${check.reason}\n` +
            '  Start the server with `npm run test:e2e:deploy` (background)\n' +
            '  or `npm run dev:http` (foreground), then re-run.',
        );
      }
      live = await connectLiveBackend();
      console.log(`  Live backend: ${live.url}`);
    }

    // Tool definitions (same as production MCP server surface)
    const arcTools = getToolDefinitions({ ...DEFAULT_CONFIG, allowWrites: true, allowFreeSQL: true });
    tools = toOpenAITools(arcTools);

    console.log(`\n  Provider: ${PROVIDER_NAME}/${MODEL}`);
    console.log(`  Backend:  ${BACKEND}`);
    console.log(`  Tools:    ${arcTools.map((t) => t.name).join(', ')}`);
    console.log(`  Files available: ${Object.keys(SCENARIO_FILES).join(', ')}`);
    console.log(`  Threshold: ${PASS_THRESHOLD}`);

    // Filter summary
    const filteredCount = ALL_SCENARIOS.filter(matchesFilters).length;
    const activeFilters: string[] = [];
    if (SCENARIO_FILTER) activeFilters.push(`scenario=${SCENARIO_FILTER}`);
    if (FILE_FILTER) activeFilters.push(`file=${FILE_FILTER.join(',')}`);
    if (TAG_FILTER) activeFilters.push(`tag=${TAG_FILTER.join(',')}`);
    if (CATEGORY_FILTER) activeFilters.push(`category=${CATEGORY_FILTER}`);
    console.log(
      `  Scenarios: ${filteredCount}/${ALL_SCENARIOS.length}` +
        (activeFilters.length ? ` (filters: ${activeFilters.join(', ')})` : '') +
        '\n',
    );
  });

  afterAll(async () => {
    if (live) {
      await live.close().catch(() => undefined);
    }
    if (allScores.length === 0) return;

    const total = allScores.length;
    const passed = allScores.filter((s) => s.passed).length;
    const avgToolSelection = allScores.reduce((sum, s) => sum + s.toolSelectionScore, 0) / total;
    const avgParameter = allScores.reduce((sum, s) => sum + s.parameterScore, 0) / total;
    const avgOverall = allScores.reduce((sum, s) => sum + s.overallScore, 0) / total;
    const avgCalls = allScores.reduce((sum, s) => sum + s.toolCallCount, 0) / total;
    const avgDuration = allScores.reduce((sum, s) => sum + s.durationMs, 0) / total;
    const totalTokens = allScores.reduce((sum, s) => sum + (s.totalTokens ?? 0), 0);

    const result: EvalRunResult = {
      model: MODEL,
      toolMode: 'standard',
      timestamp: new Date().toISOString(),
      scores: allScores,
      summary: {
        totalScenarios: total,
        passed,
        failed: total - passed,
        avgToolSelectionScore: Math.round(avgToolSelection * 100) / 100,
        avgParameterScore: Math.round(avgParameter * 100) / 100,
        avgOverallScore: Math.round(avgOverall * 100) / 100,
        avgToolCalls: Math.round(avgCalls * 100) / 100,
        avgDurationMs: Math.round(avgDuration),
        totalTokens,
      },
    };

    console.log(formatResults(result));

    const path = persistResults(result);
    if (path) console.log(`  Results written to: ${path}\n`);
  });

  // Generate a test case for each scenario.
  // We iterate ALL_SCENARIOS (not the pre-filtered list) so vitest shows the
  // full matrix in its reporter with non-matching scenarios visibly skipped.
  for (const scenario of ALL_SCENARIOS) {
    const shouldSkip = !matchesFilters(scenario);
    const testFn = shouldSkip ? it.skip : it;
    const fileTag = FILE_OF_SCENARIO[scenario.id] ?? '?';

    testFn(
      `[${fileTag}] ${scenario.id}: ${scenario.description}`,
      async () => {
        let score: ScenarioScore;
        if (PROVIDER_NAME === 'claude-code') {
          score = await runScenarioWithClaudeCode(scenario, {
            model: MODEL,
            passThreshold: PASS_THRESHOLD,
          });
        } else if (PROVIDER_NAME === 'cursor') {
          score = await runScenarioWithCursor(scenario, {
            model: MODEL,
            passThreshold: PASS_THRESHOLD,
          });
        } else {
          if (!provider) return;
          score = await runScenario(provider, scenario, tools, {
            passThreshold: PASS_THRESHOLD,
            liveExecutor: live?.execute,
          });
        }
        allScores.push(score);

        const status = score.passed ? '✅' : '❌';
        console.log(
          `    ${status} ${scenario.id} — tool:${(score.toolSelectionScore * 100).toFixed(0)}% ` +
            `params:${(score.parameterScore * 100).toFixed(0)}% calls:${score.toolCallCount} ${score.durationMs}ms`,
        );
        if (!score.passed) {
          console.log(`       ${score.explanation}`);
          if (score.trace.length > 0) {
            console.log(
              `       Trace: ${score.trace.map((t) => `${t.name}(${JSON.stringify(t.arguments)})`).join(' → ')}`,
            );
          }
        }

        expect(score.passed, score.explanation).toBe(true);
      },
      // 300s per scenario — LLM + real SAP latency. Cursor's first turn can
      // include MCP server startup + multi-call exploration, which exceeds
      // the original 180s budget.
      300_000,
    );
  }
});
