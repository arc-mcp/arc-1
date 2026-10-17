/** Persist one outcome per requested scenario, including exceptions and unfinished timeouts. */
import type { ScenarioScore } from './types.js';

export function failedScenarioScore(scenarioId: string, error?: unknown, durationMs = 0): ScenarioScore {
  return {
    scenarioId,
    toolSelectionScore: 0,
    parameterScore: 0,
    overallScore: 0,
    toolCallCount: 0,
    trace: [],
    durationMs,
    explanation:
      error === undefined
        ? 'Scenario did not return a score (timeout, setup failure or interrupted execution).'
        : `Scenario execution failed: ${error instanceof Error ? error.message : String(error)}`,
    passed: false,
  };
}

/** Snapshot the requested denominator; later asynchronous completions cannot alter this report. */
export function completeScenarioScores(
  requested: readonly { id: string }[],
  recorded: readonly ScenarioScore[],
): ScenarioScore[] {
  const byId = new Map<string, ScenarioScore>();
  // Retain the first terminal outcome; duplicate/retried completions never inflate the summary.
  for (const score of recorded) if (!byId.has(score.scenarioId)) byId.set(score.scenarioId, score);
  return [...new Set(requested.map(({ id }) => id))].map((id) => byId.get(id) ?? failedScenarioScore(id));
}

/** Vitest's timeout signal records failure immediately, even when the provider promise remains pending. */
export async function recordScenarioOutcome(
  scenarioId: string,
  recorded: ScenarioScore[],
  run: () => Promise<ScenarioScore>,
  signal: AbortSignal,
): Promise<ScenarioScore> {
  const started = Date.now();
  let finished = false;
  const record = (score: ScenarioScore) => {
    if (!finished) {
      finished = true;
      recorded.push(score);
    }
  };
  const cancelled = () =>
    record(failedScenarioScore(scenarioId, 'Eval test timed out or was cancelled', Date.now() - started));
  signal.addEventListener('abort', cancelled, { once: true });
  try {
    if (signal.aborted) throw new Error('Eval test timed out or was cancelled');
    const score = await run();
    if (signal.aborted) throw new Error('Eval test timed out or was cancelled');
    record(score);
    return score;
  } catch (error) {
    record(failedScenarioScore(scenarioId, error, Date.now() - started));
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelled);
  }
}
