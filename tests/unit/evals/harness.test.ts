import { describe, expect, it, vi } from 'vitest';
import { runScenario } from '../../evals/harness.js';
import { SCENARIOS as QUERY_SCENARIOS } from '../../evals/scenarios/query.js';
import type { LLMProvider } from '../../evals/types.js';

describe('eval harness scenario pass requirements', () => {
  it('fails a SQL-validity scenario when SAPQuery uses forbidden TOP syntax', async () => {
    const scenario = QUERY_SCENARIOS.find((candidate) => candidate.id === 'query-row-limit-parameter')!;
    const provider: LLMProvider = {
      name: 'mock',
      model: 'mock',
      chat: vi.fn().mockResolvedValue({
        done: false,
        toolCalls: [
          {
            name: 'SAPQuery',
            arguments: { sql: 'SELECT TOP 5 mandt, mtext FROM t000', maxRows: 5 },
          },
        ],
      }),
    };

    const score = await runScenario(provider, { ...scenario, maxToolCalls: 1 }, []);

    expect(score.toolSelectionScore).toBe(1);
    expect(score.parameterScore).toBeGreaterThan(0);
    expect(score.overallScore).toBeGreaterThanOrEqual(0.5);
    expect(score.passed).toBe(false);
  });
});
