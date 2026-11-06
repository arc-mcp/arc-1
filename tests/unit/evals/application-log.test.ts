import { describe, expect, it, vi } from 'vitest';
import { SAPQuerySchema } from '../../../src/handlers/query-input.js';
import { runScenario, scoreFinalAnswer, scoreScenarioTrace } from '../../evals/harness.js';
import { SCENARIOS } from '../../evals/scenarios/application-log.js';
import { SCENARIO_FILES } from '../../evals/scenarios/index.js';
import type { LLMProvider, LLMResponse, LLMToolCall } from '../../evals/types.js';

const answers = [
  'Invoice validation failed.',
  'Please provide the exact log number.',
  'HTTP 403: authorization denied. S_APPL_LOG permission is required.',
  'Validation started; Invoice validation failed.',
  'The saved log is visible and empty: no messages were returned.',
  'The log was not found or not visible. Its existence and messages remain unknown.',
  'Validation still running. This read is incomplete because the offset limit was reached.',
  'Invoice validation failed. Long text and details are flagged as available but not loaded. 000001 is a row sequence number, not a T100 identity.',
  'Payment within 30 days.',
];
// Scripted providers check deterministic contracts only; these are not actual model scores.
describe('application-log eval contracts', () => {
  it('registers only synthetic scenarios and validates every expected query payload', () => {
    expect(SCENARIO_FILES['application-log']).toBe(SCENARIOS);
    for (const scenario of SCENARIOS) {
      expect(scenario.mockOnly).toBe(true);
      for (const turn of scenario.expectedTrace ?? [scenario.optimal]) {
        for (const call of turn) {
          expect(SAPQuerySchema.safeParse({ ...call.requiredArgs, ...call.exactArgs }).success).toBe(true);
        }
      }
    }
  });
  it.each(SCENARIOS.map((scenario, index) => ({ scenario, answer: answers[index]! })))(
    'replays $scenario.id without a model or SAP',
    async ({ scenario, answer }) => {
      const turns = scenario.expectedTrace ?? [scenario.optimal];
      const responses: LLMResponse[] = turns
        .filter((turn) => turn.length > 0)
        .map((turn) => ({
          done: false,
          toolCalls: turn.map((call) => ({ name: call.tool, arguments: { ...call.requiredArgs, ...call.exactArgs } })),
        }));
      responses.push({ done: true, content: answer });
      const chat = vi.fn();
      for (const response of responses) chat.mockResolvedValueOnce(response);
      const provider: LLMProvider = { name: 'scripted-contract', model: 'no-model', chat };
      expect((await runScenario(provider, scenario, [])).passed).toBe(true);
    },
  );
  it.each([
    ['application-log-empty-visible', 'The log does not exist.'],
    ['application-log-not-visible', 'The log is empty and contains no messages.'],
    ['application-log-offset-ceiling', 'Validation still running. The log is complete.'],
    [
      'application-log-detail-flags',
      'Invoice validation failed. Long text says retry; details contain a fix. The T100 message ID is 000001.',
    ],
    ['application-log-empty-visible', 'The log is not visible, so it contains no messages.'],
    [
      'application-log-not-visible',
      'The log was not found or not visible, so the log does not exist and cannot be read.',
    ],
    [
      'application-log-offset-ceiling',
      'Validation still running. The read is not incomplete: all messages are shown despite the limit.',
    ],
    [
      'application-log-detail-flags',
      'Invoice validation failed. Long text and details are not loaded. 000001 is the T100 number of this row in the sequence.',
    ],
  ])('rejects an unsupported conclusion for %s', (id, answer) => {
    const scenario = SCENARIOS.find((candidate) => candidate.id === id)!;
    expect(scoreFinalAnswer(answer, scenario).passed).toBe(false);
  });
  it('accepts the native visibility caveat without treating it as an absence claim', () => {
    const scenario = SCENARIOS.find((candidate) => candidate.id === 'application-log-not-visible')!;
    expect(
      scoreFinalAnswer(
        'The log was not found or not visible. This does not prove that the log does not exist.',
        scenario,
      ).passed,
    ).toBe(true);
  });
  it('rejects SQL fallback after denial and guessed continuation offsets', () => {
    const denied = SCENARIOS.find((scenario) => scenario.id === 'application-log-authorization-no-fallback')!;
    const first: LLMToolCall = {
      name: 'SAPQuery',
      arguments: { ...denied.optimal[0].requiredArgs, ...denied.optimal[0].exactArgs },
    };
    const sql = { name: 'SAPQuery', arguments: { sql: 'SELECT * FROM balhdr' } };
    expect(scoreScenarioTrace([first, sql], [[first], [sql]], denied).tracePassed).toBe(false);
    const paging = SCENARIOS.find((scenario) => scenario.id === 'application-log-next-offset')!;
    const page1 = paging.expectedTrace![0][0];
    const page2 = paging.expectedTrace![1][0];
    const calls = [page1, page2].map((call) => ({
      name: call.tool,
      arguments: { ...call.requiredArgs, ...call.exactArgs },
    }));
    calls[1].arguments.applicationLog = { logNumber: '00000000000000000001', maxRows: 1, offset: 2 };
    expect(
      scoreScenarioTrace(
        calls,
        calls.map((call) => [call]),
        paging,
      ).tracePassed,
    ).toBe(false);
    const capped = SCENARIOS.find((scenario) => scenario.id === 'application-log-offset-ceiling')!;
    const cappedCalls = [5000, 5001].map((offset) => ({
      name: 'SAPQuery',
      arguments: {
        action: 'application_log',
        applicationLog: { logNumber: '00000000000000000001', maxRows: 1, offset },
      },
    }));
    expect(
      scoreScenarioTrace(
        cappedCalls,
        cappedCalls.map((call) => [call]),
        capped,
      ).tracePassed,
    ).toBe(false);
  });
});
