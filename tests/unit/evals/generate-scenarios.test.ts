import { describe, expect, it } from 'vitest';
import { scenarioPasses } from '../../evals/expected-call.js';
import { scoreScenarioTrace } from '../../evals/harness.js';
import { SCENARIOS } from '../../evals/scenarios/generate.js';
import type { LLMToolCall } from '../../evals/types.js';

const scenario = SCENARIOS.find((s) => s.id === 'generate-natural-ui-service')!;
const call = (name: string, args: Record<string, unknown>): LLMToolCall => ({ name, arguments: args });
const read = call('SAPRead', { type: 'TABL', name: 'ZTRAVEL' });
const dry = (extra: Record<string, unknown>) =>
  call('SAPWrite', { action: 'generate', type: 'TABL', name: 'ZTRAVEL', generator: 'ui-service', ...extra });
const passes = (trace: LLMToolCall[]) => {
  const score = scoreScenarioTrace(trace, [trace], scenario);
  return score.tracePassed && scenarioPasses(scenario, score.toolSelectionScore, score.parameterScore, 0.5);
};

describe('generate eval scoring', () => {
  it('allows reading first, then scores the first generate call', () => {
    expect(passes([read, dry({ dryRun: true })])).toBe(true);
    expect(passes([dry({ dryRun: 'true' })])).toBe(true);
    expect(passes([call('SAPTransport', { action: 'get', id: 'A4HK900123' }), dry({ dryRun: true })])).toBe(true);
  });

  it('fails reads only, a real run first, or another SAPWrite action', () => {
    expect(passes([read, call('SAPSearch', { query: 'ZTRAVEL' })])).toBe(false);
    expect(passes([read, dry({})])).toBe(false);
    expect(passes([call('SAPWrite', { action: 'create', type: 'DDLS', name: 'ZR_TRAVEL' })])).toBe(false);
  });
});
