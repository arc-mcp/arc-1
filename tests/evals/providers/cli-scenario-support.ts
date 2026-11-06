/** CLI adapters currently expose a flat call list, without turn/final-answer grading. */
import type { EvalScenario, ScenarioScore } from '../types.js';

export function unsupportedCliScenario(scenario: EvalScenario, provider: string): ScenarioScore | undefined {
  if (scenario.expectedTrace === undefined && scenario.finalAnswer === undefined && !scenario.noFirstCall) return;
  return {
    scenarioId: scenario.id,
    toolSelectionScore: 0,
    parameterScore: 0,
    overallScore: 0,
    toolCallCount: 0,
    trace: [],
    durationMs: 0,
    explanation: `UNSUPPORTED_SCENARIO: ${provider} cannot grade expectedTrace, finalAnswer or noFirstCall; use a chat-loop provider.`,
    passed: false,
  };
}
