import { describe, expect, it } from 'vitest';
import { matchesExpectedToolCall } from '../../evals/expected-call.js';
import { scoreFinalAnswer } from '../../evals/harness.js';
import { SCENARIOS } from '../../evals/scenarios/stored-text.js';

const scenario = (id: string) => {
  const found = SCENARIOS.find((item) => item.id === id);
  if (!found) throw new Error(`Missing answer assertion fixture ${id}`);
  return found;
};

// Deterministic specification examples, independent of any model output. These check
// required lexical facts; they do not establish that arbitrary prose is semantically correct.
describe('stored-text final-answer assertion regressions', () => {
  it('requires actual language words/codes and rejects guessed language filters in ambiguous discovery', () => {
    const spec = scenario('stored-text-ask-language-when-ambiguous');
    expect(scoreFinalAnswer('Which language should I use?', spec).passed).toBe(false);
    expect(scoreFinalAnswer('Which do you prefer: English or German?', spec).passed).toBe(true);
    expect(scoreFinalAnswer('Which language: E or D?', spec).passed).toBe(true);
    const expected = spec.expectedTrace![0][0];
    const discovery = { mode: 'discover', object: 'TEXT', namePrefix: 'Z_PAYMENT_NOTICE' };
    for (const language of ['E', 'D']) {
      expect(
        matchesExpectedToolCall(
          { name: 'SAPQuery', arguments: { action: 'long_text', longText: { ...discovery, language } } },
          expected,
        ),
      ).toBe(false);
    }
    for (const language of [undefined, null]) {
      expect(
        matchesExpectedToolCall(
          { name: 'SAPQuery', arguments: { action: 'long_text', longText: { ...discovery, language } } },
          expected,
        ),
      ).toBe(true);
    }
  });
  it.each([
    {
      id: 'stored-text-search-only-supplied-keys',
      correct:
        'Z_PAYMENT_NOTICE and Z_PAYMENT_REFERENCE matched Payment within 30 days. Z_MISSING: NOT_FOUND. Not all reads succeeded.',
      incorrect: 'Z_PAYMENT_NOTICE matched Payment within 30 days. Z_MISSING: NOT_FOUND.',
    },
    {
      id: 'stored-text-batch-keeps-item-errors-local',
      correct: 'Z_PAYMENT_NOTICE: Payment within 30 days.\nZ_MISSING: NOT_FOUND',
      incorrect: 'Z_PAYMENT_NOTICE: NOT_FOUND.\nZ_MISSING: NOT_FOUND.',
    },
    {
      id: 'stored-text-missing-does-not-prove-archive-absence',
      correct: 'NOT_FOUND in classic storage does not prove that it is not in any archive.',
      incorrect: 'NOT_FOUND in classic storage means it is absent from all archives and memory.',
    },
  ])('accepts a correct explanation and rejects missing decisive facts: $id', ({ id, correct, incorrect }) => {
    const spec = scenario(id);
    expect(scoreFinalAnswer(correct, spec)).toEqual({ passed: true });
    expect(scoreFinalAnswer(incorrect, spec).passed).toBe(false);
    expect(scoreFinalAnswer('', spec).passed).toBe(false);
    expect(scoreFinalAnswer(undefined, spec).passed).toBe(false);
  });
});
