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
  ExpectedToolCall,
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

interface TraceScore {
  toolSelectionScore: number;
  parameterScore: number;
  explanation: string;
  tracePassed: boolean;
}

/** Score the full trace when specified; otherwise retain the historical first-call scoring. */
export function scoreScenarioTrace(trace: LLMToolCall[], turns: LLMToolCall[][], scenario: EvalScenario): TraceScore {
  const forbidden = trace.find((call) => scenario.forbidden?.includes(call.name));
  if (forbidden) {
    return {
      toolSelectionScore: 0,
      parameterScore: 0,
      explanation: `Called forbidden tool in trace: ${forbidden.name}`,
      tracePassed: false,
    };
  }

  if (scenario.noFirstCall) {
    const passed = trace.length === 0;
    return {
      toolSelectionScore: passed ? 1 : 0,
      parameterScore: 1,
      explanation: passed
        ? 'Correctly made no tool calls'
        : `Expected clarification without tools; observed ${trace.length} call(s)`,
      tracePassed: passed,
    };
  }

  if (scenario.expectedTrace) {
    const expectedTurns = scenario.expectedTrace;
    const slots = expectedTurns.reduce((sum, turn) => sum + turn.length, 0);
    const actualSlots = turns.reduce((sum, turn) => sum + turn.length, 0);
    let matchedTools = 0;
    let parameterTotal = 0;
    let exact = turns.length === expectedTurns.length && actualSlots === slots;

    for (let turnIndex = 0; turnIndex < expectedTurns.length; turnIndex++) {
      const expectedCalls = expectedTurns[turnIndex] ?? [];
      const actualCalls = turns[turnIndex] ?? [];
      if (actualCalls.length !== expectedCalls.length) exact = false;
      for (let callIndex = 0; callIndex < expectedCalls.length; callIndex++) {
        const expected = expectedCalls[callIndex]!;
        const actual = actualCalls[callIndex];
        if (!actual) continue;
        if (actual.name === expected.tool) {
          matchedTools++;
          parameterTotal += scoreExpectedToolCallParameters(actual, expected);
          if (!matchesExpectedToolCall(actual, expected)) exact = false;
        } else {
          exact = false;
        }
      }
    }
    if (actualSlots > slots) exact = false;
    const denominator = Math.max(slots, actualSlots, 1);
    const toolSelectionScore = slots === 0 && actualSlots === 0 ? 1 : matchedTools / denominator;
    const parameterScore = slots === 0 ? 1 : parameterTotal / slots;
    return {
      toolSelectionScore,
      parameterScore,
      explanation: exact
        ? 'Expected tool trace matched'
        : `Tool trace mismatch: expected ${slots} call(s) across ${expectedTurns.length} turn(s), observed ${actualSlots} across ${turns.length}`,
      tracePassed: exact,
    };
  }

  if (trace.length === 0) {
    return {
      toolSelectionScore: 0,
      parameterScore: 0,
      explanation: 'LLM did not make any tool calls',
      tracePassed: false,
    };
  }

  const firstCall = trace[0]!;
  const scoreFirstMatch = (expected: ExpectedToolCall, selection: number, label: string): TraceScore => ({
    toolSelectionScore: selection,
    parameterScore: scoreExpectedToolCallParameters(firstCall, expected),
    explanation: `${label}: ${firstCall.name}(${JSON.stringify(firstCall.arguments)})`,
    tracePassed: true,
  });

  for (const expected of scenario.optimal) {
    if (matchesExpectedToolCall(firstCall, expected)) return scoreFirstMatch(expected, 1, 'Optimal');
  }
  for (const expected of scenario.optimal) {
    if (firstCall.name === expected.tool)
      return scoreFirstMatch(expected, 1, `Correct tool ${firstCall.name}, parameters partial`);
  }
  for (const expected of scenario.acceptable ?? []) {
    if (matchesExpectedToolCall(firstCall, expected)) return scoreFirstMatch(expected, 0.5, 'Acceptable alternative');
  }
  for (const expected of scenario.acceptable ?? []) {
    if (firstCall.name === expected.tool)
      return scoreFirstMatch(expected, 0.5, `Acceptable tool ${firstCall.name}, parameters partial`);
  }
  return {
    toolSelectionScore: 0,
    parameterScore: 0,
    explanation: `Wrong tool: ${firstCall.name}(${JSON.stringify(firstCall.arguments)}). Expected: ${scenario.optimal.map((e) => e.tool).join(' or ')}`,
    tracePassed: false,
  };
}

export function scoreFinalAnswer(
  answer: string | undefined,
  scenario: EvalScenario,
): { passed: boolean; explanation?: string } {
  const expected = scenario.finalAnswer;
  if (!expected) return { passed: true };
  if (answer === undefined) return { passed: false, explanation: 'No final assistant answer was captured' };
  if (expected.requireNonEmpty && !answer.trim())
    return { passed: false, explanation: 'Final assistant answer was empty' };
  for (const pattern of expected.required ?? []) {
    pattern.lastIndex = 0;
    if (!pattern.test(answer)) return { passed: false, explanation: `Final answer missed required pattern ${pattern}` };
  }
  for (const pattern of expected.forbidden ?? []) {
    pattern.lastIndex = 0;
    if (pattern.test(answer))
      return { passed: false, explanation: `Final answer included forbidden pattern ${pattern}` };
  }
  return { passed: true };
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
  options?: { passThreshold?: number; liveExecutor?: LiveExecutor; signal?: AbortSignal },
): Promise<ScenarioScore> {
  const signal = options?.signal;
  signal?.throwIfAborted();
  if (scenario.mockOnly && options?.liveExecutor) {
    throw new Error(`Scenario ${scenario.id} uses synthetic SAP fixtures and cannot run against a live backend.`);
  }
  const startTime = Date.now();
  const trace: LLMToolCall[] = [];
  const traceTurns: LLMToolCall[][] = [];
  let totalTokens = 0;
  let promptTokens = 0;
  let maxPromptTokens = 0;
  let completionTokens = 0;
  let finalAnswer: string | undefined;
  let validationFailure: string | undefined;
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
  let turn = 0;
  while (callCount < maxCalls) {
    signal?.throwIfAborted();
    turn++;
    // Keep the historical two-argument provider call unless cancellation was supplied.
    const response = signal ? await provider.chat(messages, tools, { signal }) : await provider.chat(messages, tools);
    signal?.throwIfAborted();

    if (response.usage) {
      totalTokens += response.usage.totalTokens;
      promptTokens += response.usage.promptTokens;
      maxPromptTokens = Math.max(maxPromptTokens, response.usage.promptTokens);
      completionTokens += response.usage.completionTokens;
    }

    // LLM is done (text response, no tool calls)
    if (response.done || !response.toolCalls?.length) {
      finalAnswer = response.content ?? '';
      break;
    }

    // Assign IDs once and keep parallel calls in their original assistant turn.
    const proposedCalls = response.toolCalls.map((call, index) => ({
      ...call,
      id: call.id || `call_${callCount + index + 1}`,
    }));
    const remainingCalls = Math.max(0, Math.ceil(maxCalls - callCount));
    const toolCalls = proposedCalls.slice(0, remainingCalls);
    const overflowCalls = proposedCalls.slice(remainingCalls);
    messages.push({ role: 'assistant', content: response.content, toolCalls: proposedCalls });
    const currentTurn: LLMToolCall[] = [];
    for (const toolCall of toolCalls) {
      signal?.throwIfAborted();
      trace.push(toolCall);
      currentTurn.push(toolCall);
      callCount++;

      // Live mode routes to a real MCP server; otherwise fall back to mocks.
      // Live calls can throw (network, auth); surface the error back to the
      // LLM as tool output so the agentic loop can observe and react — same
      // shape it would see in production.
      let toolContent: string;
      if (scenario.mockToolExecutor) {
        toolContent = await scenario.mockToolExecutor(toolCall.name, toolCall.arguments);
        if (toolContent.startsWith(`Invalid arguments for ${toolCall.name}:`)) {
          validationFailure ??= `${toolCall.name} arguments failed production schema validation on turn ${turn}`;
        }
      } else if (liveExecutor) {
        try {
          toolContent = await liveExecutor(toolCall.name, toolCall.arguments);
        } catch (err) {
          toolContent = `[tool error] ${err instanceof Error ? err.message : String(err)}`;
        }
      } else {
        toolContent = getMockResponse(scenario, toolCall);
      }

      signal?.throwIfAborted();
      // Add tool result
      messages.push({
        role: 'tool',
        content: toolContent,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      });
    }
    signal?.throwIfAborted();
    for (const toolCall of overflowCalls) {
      trace.push(toolCall);
      currentTurn.push(toolCall);
      messages.push({
        role: 'tool',
        content: `Harness tool-call limit reached (${maxCalls}); call was observed but not executed.`,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      });
    }
    traceTurns.push(currentTurn);
  }

  // Score the trace
  const {
    toolSelectionScore,
    parameterScore,
    explanation: traceExplanation,
    tracePassed,
  } = scoreScenarioTrace(trace, traceTurns, scenario);
  const answerScore = scoreFinalAnswer(finalAnswer, scenario);
  const explanation = [traceExplanation, validationFailure, answerScore.explanation].filter(Boolean).join('; ');
  const overallScore = toolSelectionScore * 0.6 + parameterScore * 0.4;
  const durationMs = Date.now() - startTime;

  return {
    scenarioId: scenario.id,
    toolSelectionScore,
    parameterScore,
    overallScore,
    toolCallCount: trace.length,
    trace,
    traceTurns,
    finalAnswer: scenario.finalAnswer ? finalAnswer : undefined,
    finalAnswerPassed: answerScore.passed,
    tracePassed: tracePassed && !validationFailure,
    totalTokens,
    promptTokens,
    maxPromptTokens,
    completionTokens,
    durationMs,
    explanation,
    passed:
      scenarioPasses(scenario, overallScore, parameterScore, passThreshold) &&
      tracePassed &&
      !validationFailure &&
      answerScore.passed,
  };
}

/** Static tool-name mocks for scenarios that do not need a fixture executor. */
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
  options?: { passThreshold?: number; liveExecutor?: LiveExecutor; signal?: AbortSignal },
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
  const totalPromptTokens = scores.reduce((sum, s) => sum + (s.promptTokens ?? 0), 0);
  const totalCompletionTokens = scores.reduce((sum, s) => sum + (s.completionTokens ?? 0), 0);

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
      totalPromptTokens,
      totalCompletionTokens,
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
