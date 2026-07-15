/**
 * LLM Eval Harness — runs scenarios against LLM providers and scores tool call accuracy.
 *
 * The harness implements the agentic loop:
 *   1. Send system prompt + tool definitions + user prompt to LLM
 *   2. If LLM generates tool call → return mock response → feed back to LLM
 *   3. Repeat until LLM produces text response or max steps reached
 *   4. Score the captured tool trace against expected behavior
 *
 * Scoring uses tiered evaluation:
 *   - Optimal tool call: 1.0
 *   - Acceptable alternative: 0.5
 *   - Wrong tool / forbidden tool: 0.0
 */

import { matchesExpectedToolCall, scenarioPasses, scoreExpectedToolCallParameters } from './expected-call.js';
import type { LiveExecutor } from './live-backend.js';
import type {
  EvalRunResult,
  EvalScenario,
  LLMProvider,
  LLMToolCall,
  Message,
  ScenarioScore,
  ToolDefinitionForLLM,
} from './types.js';

/** Default max tool calls before stopping the loop */
const DEFAULT_MAX_TOOL_CALLS = 5;

/** Default pass threshold */
const DEFAULT_PASS_THRESHOLD = 0.5;

// ─── System Prompt ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI assistant connected to an SAP ABAP system via MCP tools.
When the user asks you to perform SAP-related tasks, use the available tools.
Choose the most appropriate tool and provide the correct parameters.
Be efficient — use the fewest tool calls necessary to accomplish the task.
When you have enough information, respond with a text summary.`;

// ─── Tool Call Scoring ──────────────────────────────────────────────

/** Score the first tool call against optimal/acceptable/forbidden expectations */
function scoreFirstToolCall(
  trace: LLMToolCall[],
  scenario: EvalScenario,
): { toolSelectionScore: number; parameterScore: number; explanation: string } {
  if (trace.length === 0) {
    return {
      toolSelectionScore: 0,
      parameterScore: 0,
      explanation: 'LLM did not make any tool calls',
    };
  }

  const firstCall = trace[0];

  // Check forbidden tools
  if (scenario.forbidden?.includes(firstCall.name)) {
    return {
      toolSelectionScore: 0,
      parameterScore: 0,
      explanation: `Called forbidden tool: ${firstCall.name}`,
    };
  }

  // Check optimal match
  for (const expected of scenario.optimal) {
    if (matchesExpectedToolCall(firstCall, expected)) {
      // Score parameters: check how many required args are correct
      const paramScore = scoreExpectedToolCallParameters(firstCall, expected);
      return {
        toolSelectionScore: 1.0,
        parameterScore: paramScore,
        explanation: `Optimal: ${firstCall.name}(${JSON.stringify(firstCall.arguments)})`,
      };
    }
  }

  // Check if tool name matches optimal but params are wrong
  for (const expected of scenario.optimal) {
    if (firstCall.name === expected.tool) {
      const paramScore = scoreExpectedToolCallParameters(firstCall, expected);
      return {
        toolSelectionScore: 1.0,
        parameterScore: paramScore,
        explanation: `Correct tool ${firstCall.name} but params partially wrong: ${JSON.stringify(firstCall.arguments)}`,
      };
    }
  }

  // Check acceptable alternatives
  if (scenario.acceptable) {
    for (const expected of scenario.acceptable) {
      if (matchesExpectedToolCall(firstCall, expected)) {
        const paramScore = scoreExpectedToolCallParameters(firstCall, expected);
        return {
          toolSelectionScore: 0.5,
          parameterScore: paramScore,
          explanation: `Acceptable alternative: ${firstCall.name}(${JSON.stringify(firstCall.arguments)})`,
        };
      }
    }

    // Check if tool name matches acceptable but params wrong
    for (const expected of scenario.acceptable) {
      if (firstCall.name === expected.tool) {
        const paramScore = scoreExpectedToolCallParameters(firstCall, expected);
        return {
          toolSelectionScore: 0.5,
          parameterScore: paramScore,
          explanation: `Acceptable tool ${firstCall.name} but params partially wrong`,
        };
      }
    }
  }

  return {
    toolSelectionScore: 0,
    parameterScore: 0,
    explanation: `Wrong tool: ${firstCall.name}(${JSON.stringify(firstCall.arguments)}). Expected: ${scenario.optimal.map((e) => e.tool).join(' or ')}`,
  };
}

// ─── Eval Loop ──────────────────────────────────────────────────────

/**
 * Run a single scenario against an LLM provider.
 * Implements the full agentic tool-calling loop.
 */
export async function runScenario(
  provider: LLMProvider,
  scenario: EvalScenario,
  tools: ToolDefinitionForLLM[],
  options?: { passThreshold?: number; liveExecutor?: LiveExecutor },
): Promise<ScenarioScore> {
  const startTime = Date.now();
  const trace: LLMToolCall[] = [];
  let totalTokens = 0;
  const maxCalls = scenario.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const passThreshold = options?.passThreshold ?? DEFAULT_PASS_THRESHOLD;
  const liveExecutor = options?.liveExecutor;

  // Build initial messages
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: scenario.prompt },
  ];

  // Agentic loop: LLM → tool call → {mock or live} response → LLM → ...
  let callCount = 0;
  while (callCount < maxCalls) {
    const response = await provider.chat(messages, tools);

    if (response.usage) {
      totalTokens += response.usage.totalTokens;
    }

    // LLM is done (text response, no tool calls)
    if (response.done || !response.toolCalls?.length) {
      break;
    }

    // Process tool calls
    for (const toolCall of response.toolCalls) {
      trace.push(toolCall);
      callCount++;

      // Live mode routes to a real MCP server; otherwise fall back to mocks.
      // Live calls can throw (network, auth); surface the error back to the
      // LLM as tool output so the agentic loop can observe and react — same
      // shape it would see in production.
      let toolContent: string;
      if (liveExecutor) {
        try {
          toolContent = await liveExecutor(toolCall.name, toolCall.arguments);
        } catch (err) {
          toolContent = `[tool error] ${err instanceof Error ? err.message : String(err)}`;
        }
      } else {
        toolContent = getMockResponse(scenario, toolCall);
      }

      // Add assistant message with tool call
      messages.push({
        role: 'assistant',
        toolCalls: [toolCall],
      });

      // Add tool result
      messages.push({
        role: 'tool',
        content: toolContent,
        toolCallId: `call_${callCount}`,
        toolName: toolCall.name,
      });
    }
  }

  // Score the trace
  const { toolSelectionScore, parameterScore, explanation } = scoreFirstToolCall(trace, scenario);
  const overallScore = toolSelectionScore * 0.6 + parameterScore * 0.4;
  const durationMs = Date.now() - startTime;

  return {
    scenarioId: scenario.id,
    toolSelectionScore,
    parameterScore,
    overallScore,
    toolCallCount: trace.length,
    trace,
    totalTokens,
    durationMs,
    explanation,
    passed: scenarioPasses(scenario, overallScore, parameterScore, passThreshold),
  };
}

/** Get a mock response for a tool call */
function getMockResponse(scenario: EvalScenario, toolCall: LLMToolCall): string {
  if (!scenario.mockResponses) {
    return JSON.stringify({ status: 'ok', message: `Mock response for ${toolCall.name}` });
  }

  // Try exact tool name match
  if (scenario.mockResponses[toolCall.name]) {
    return scenario.mockResponses[toolCall.name];
  }

  // Try wildcard fallback
  if (scenario.mockResponses['*']) {
    return scenario.mockResponses['*'];
  }

  return JSON.stringify({ status: 'ok', message: `No mock configured for ${toolCall.name}` });
}

// ─── Eval Run ───────────────────────────────────────────────────────

/**
 * Run all scenarios against a provider and produce an EvalRunResult.
 */
export async function runEval(
  provider: LLMProvider,
  scenarios: EvalScenario[],
  tools: ToolDefinitionForLLM[],
  toolMode: 'standard' | 'hyperfocused' = 'standard',
  options?: { passThreshold?: number; liveExecutor?: LiveExecutor },
): Promise<EvalRunResult> {
  const scores: ScenarioScore[] = [];

  for (const scenario of scenarios) {
    try {
      const score = await runScenario(provider, scenario, tools, options);
      scores.push(score);
    } catch (err) {
      // Record error as a failed scenario
      scores.push({
        scenarioId: scenario.id,
        toolSelectionScore: 0,
        parameterScore: 0,
        overallScore: 0,
        toolCallCount: 0,
        trace: [],
        durationMs: 0,
        explanation: `Error: ${err instanceof Error ? err.message : String(err)}`,
        passed: false,
      });
    }
  }

  // Compute summary
  const total = scores.length;
  const passed = scores.filter((s) => s.passed).length;
  const avgToolSelection = scores.reduce((sum, s) => sum + s.toolSelectionScore, 0) / total;
  const avgParameter = scores.reduce((sum, s) => sum + s.parameterScore, 0) / total;
  const avgOverall = scores.reduce((sum, s) => sum + s.overallScore, 0) / total;
  const avgCalls = scores.reduce((sum, s) => sum + s.toolCallCount, 0) / total;
  const avgDuration = scores.reduce((sum, s) => sum + s.durationMs, 0) / total;
  const totalTokens = scores.reduce((sum, s) => sum + (s.totalTokens ?? 0), 0);

  return {
    model: provider.model,
    toolMode,
    timestamp: new Date().toISOString(),
    scores,
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
}

// ─── Tool Definition Converter ──────────────────────────────────────

/**
 * Convert ARC-1's ToolDefinition format to the OpenAI function-calling format
 * that both Ollama and Anthropic providers understand.
 */
export function toOpenAITools(
  arcTools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>,
): ToolDefinitionForLLM[] {
  return arcTools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

// ─── Pretty Printing ────────────────────────────────────────────────

/** Format eval results as a readable table */
export function formatResults(result: EvalRunResult): string {
  const lines: string[] = [];

  lines.push(`\n${'═'.repeat(70)}`);
  lines.push(`  LLM Eval Results — ${result.model} (${result.toolMode} mode)`);
  lines.push(`  ${result.timestamp}`);
  lines.push(`${'═'.repeat(70)}\n`);

  // Per-scenario results
  for (const score of result.scores) {
    const status = score.passed ? '✅' : '❌';
    const toolScore = `tool:${(score.toolSelectionScore * 100).toFixed(0)}%`;
    const paramScore = `params:${(score.parameterScore * 100).toFixed(0)}%`;
    lines.push(
      `  ${status} ${score.scenarioId.padEnd(35)} ${toolScore.padEnd(10)} ${paramScore.padEnd(12)} calls:${score.toolCallCount} ${score.durationMs}ms`,
    );
    if (!score.passed) {
      lines.push(`     └─ ${score.explanation}`);
    }
  }

  // Summary
  lines.push(`\n${'─'.repeat(70)}`);
  lines.push(
    `  Summary: ${result.summary.passed}/${result.summary.totalScenarios} passed` +
      ` | Tool Selection: ${(result.summary.avgToolSelectionScore * 100).toFixed(0)}%` +
      ` | Params: ${(result.summary.avgParameterScore * 100).toFixed(0)}%` +
      ` | Overall: ${(result.summary.avgOverallScore * 100).toFixed(0)}%`,
  );
  lines.push(
    `  Avg calls: ${result.summary.avgToolCalls}` +
      ` | Avg latency: ${result.summary.avgDurationMs}ms` +
      ` | Total tokens: ${result.summary.totalTokens}`,
  );
  lines.push(`${'═'.repeat(70)}\n`);

  return lines.join('\n');
}
