import { describe, expect, it } from 'vitest';
import { completeScenarioScores, failedScenarioScore, recordScenarioOutcome } from '../../evals/completion.js';
import type { ScenarioScore } from '../../evals/types.js';

function success(id: string): ScenarioScore {
  return {
    ...failedScenarioScore(id),
    passed: true,
    overallScore: 1,
    parameterScore: 1,
    toolSelectionScore: 1,
    totalTokens: 100,
    promptTokens: 80,
    completionTokens: 20,
    explanation: 'Passed',
  };
}

describe('eval completion accounting', () => {
  it('keeps the requested denominator when only seven of ten scenarios returned scores', () => {
    const requested = Array.from({ length: 10 }, (_, index) => ({ id: `scenario-${index}` }));
    const recorded = requested
      .slice(0, 7)
      .map(({ id }, index) => (index < 3 ? success(id) : failedScenarioScore(id, 'Wrong tool')));
    const scores = completeScenarioScores(requested, recorded);
    expect(scores).toHaveLength(10);
    expect(scores.filter(({ passed }) => passed)).toHaveLength(3);
    expect(scores.filter(({ passed }) => !passed)).toHaveLength(7);
    expect(scores.slice(7).every(({ explanation }) => explanation.includes('did not return a score'))).toBe(true);
    expect(scores.reduce((sum, score) => sum + (score.totalTokens ?? 0), 0)).toBe(300);
  });

  it('records thrown failures with the scenario identity and elapsed duration', () => {
    expect(failedScenarioScore('thrown', new Error('Provider unavailable'), 125)).toMatchObject({
      scenarioId: 'thrown',
      passed: false,
      durationMs: 125,
      explanation: 'Scenario execution failed: Provider unavailable',
    });
  });

  it('records every requested scenario when setup failed before any score returned', () => {
    expect(completeScenarioScores([{ id: 'first' }, { id: 'second' }], [])).toMatchObject([
      { scenarioId: 'first', passed: false },
      { scenarioId: 'second', passed: false },
    ]);
  });

  it('deduplicates completions, excludes unrequested outcomes, and preserves requested order', () => {
    const first = failedScenarioScore('first', 'Timed out');
    const second = success('second');
    expect(
      completeScenarioScores([{ id: 'first' }, { id: 'second' }], [second, first, success('first'), success('other')]),
    ).toEqual([first, second]);
    expect(completeScenarioScores([], [success('other')])).toEqual([]);
  });

  it('does not let a late timeout completion change the finalized report', () => {
    const recorded: ScenarioScore[] = [];
    const scores = completeScenarioScores([{ id: 'timed-out' }], recorded);
    recorded.push(success('timed-out'));
    expect(scores).toHaveLength(1);
    expect(scores[0].passed).toBe(false);
    expect(scores[0].explanation).toContain('timeout');
  });

  it('records a timeout immediately and refuses a late provider success before finalization', async () => {
    const controller = new AbortController();
    const recorded: ScenarioScore[] = [];
    let resolve!: (score: ScenarioScore) => void;
    const pending = recordScenarioOutcome(
      'timeout',
      recorded,
      () =>
        new Promise((done) => {
          resolve = done;
        }),
      controller.signal,
    );
    controller.abort();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ scenarioId: 'timeout', passed: false });
    resolve(success('timeout'));
    await expect(pending).rejects.toThrow('timed out or was cancelled');
    expect(recorded).toHaveLength(1);
    expect(completeScenarioScores([{ id: 'timeout' }], recorded)[0].passed).toBe(false);
  });

  it('records a thrown provider error once and preserves it for the test runner', async () => {
    const recorded: ScenarioScore[] = [];
    const error = new Error('Provider failed');
    await expect(
      recordScenarioOutcome(
        'failure',
        recorded,
        async () => {
          throw error;
        },
        new AbortController().signal,
      ),
    ).rejects.toBe(error);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ passed: false, explanation: 'Scenario execution failed: Provider failed' });
  });
});
