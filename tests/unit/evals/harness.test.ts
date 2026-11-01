import { describe, expect, it, vi } from 'vitest';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { runScenario } from '../../evals/harness.js';
import { SCENARIOS as QUERY_SCENARIOS } from '../../evals/scenarios/query.js';
import { SCENARIOS as STORED_TEXT_SCENARIOS, storedTextFixtureExecutor } from '../../evals/scenarios/stored-text.js';
import type { LLMProvider } from '../../evals/types.js';

describe('eval harness scenario pass requirements', () => {
  it('exposes the on-prem long_text schema together with realistic distractor tools', () => {
    const definitions = getToolDefinitions({
      ...DEFAULT_CONFIG,
      systemType: 'onprem',
      allowDataPreview: true,
      allowWrites: true,
      allowFreeSQL: true,
    });
    const query = definitions.find((tool) => tool.name === 'SAPQuery');
    const properties = query?.inputSchema.properties as Record<string, unknown>;
    expect((properties.action as { enum: string[] }).enum).toContain('long_text');
    expect(properties.longText).toBeDefined();
    expect(definitions.map((tool) => tool.name)).toEqual(expect.arrayContaining(['SAPQuery', 'SAPWrite', 'SAPSearch']));
  });

  it('replays stored-text scenarios through the public dispatcher using synthetic SAP tables', async () => {
    const invalid = await storedTextFixtureExecutor('SAPQuery', {
      action: 'long_text',
      longText: { mode: 'read', keys: [{ object: 'TEXT', name: 'Z_PAYMENT_NOTICE', id: 'ST', language: 'EN' }] },
    });
    expect(invalid).toContain('Invalid arguments for SAPQuery');

    const missing = await storedTextFixtureExecutor('SAPQuery', {
      action: 'long_text',
      longText: { mode: 'read', keys: [{ object: 'TEXT', name: 'Z_MISSING', id: 'ST', language: 'E' }] },
    });
    expect(JSON.parse(missing)).toMatchObject({
      mode: 'read',
      items: [{ status: 'error', error: { code: 'NOT_FOUND' } }],
    });
  });

  it('refuses to route synthetic-key scenarios through a live executor', async () => {
    const scenario = STORED_TEXT_SCENARIOS.find(
      (candidate) => candidate.id === 'stored-text-so10-not-program-text-elements',
    )!;
    const provider: LLMProvider = {
      name: 'scripted',
      model: 'fixture',
      chat: vi.fn(),
    };
    await expect(runScenario(provider, scenario, [], { liveExecutor: vi.fn() })).rejects.toThrow(
      'uses synthetic SAP fixtures and cannot run against a live backend',
    );
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it.each([
    [
      'stored-text-missing-does-not-prove-archive-absence',
      'NOT_FOUND in classic storage, so it cannot exist in any archive or memory.',
    ],
    ['stored-text-search-only-supplied-keys', 'Z_PAYMENT_NOTICE had one match; all reads succeeded.'],
    ['stored-text-batch-keeps-item-errors-local', 'Z_PAYMENT_NOTICE and Z_MISSING are both NOT_FOUND.'],
  ])('rejects misleading final answer for %s', async (scenarioId, answer) => {
    const scenario = STORED_TEXT_SCENARIOS.find((candidate) => candidate.id === scenarioId)!;
    const provider: LLMProvider = {
      name: 'scripted',
      model: 'fixture',
      chat: vi.fn().mockResolvedValue({ done: true, content: answer }),
    };
    const score = await runScenario(provider, { ...scenario, noFirstCall: true, expectedTrace: [] }, []);
    expect(score.tracePassed).toBe(true);
    expect(score.finalAnswerPassed).toBe(false);
    expect(score.passed).toBe(false);
  });

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

  it('scores an ordered multi-turn trace using a scenario executor', async () => {
    const readKey = { object: 'EKKO', name: '4500000010', id: 'F01', language: 'E' };
    const scenario = {
      id: 'long-text-discover-read',
      description: 'Discover then read an exact text key',
      category: 'read',
      prompt: 'Find the PO header note and read it.',
      optimal: [{ tool: 'SAPQuery', requiredArgs: { action: 'long_text' } }],
      expectedTrace: [
        [{ tool: 'SAPQuery', requiredArgs: { action: 'long_text', longText: { mode: 'discover' } } }],
        [{ tool: 'SAPQuery', requiredArgs: { action: 'long_text', longText: { mode: 'read' } } }],
      ],
      mockToolExecutor: async (_tool: string, args: Record<string, unknown>) =>
        (args.longText as { mode: string }).mode === 'discover' ? 'discovery fixture' : 'read fixture',
      finalAnswer: { required: [/read fixture/i], forbidden: [/not found/i], requireNonEmpty: true },
      requireFullParameters: true,
    };
    const provider: LLMProvider = {
      name: 'scripted',
      model: 'fixture',
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          toolCalls: [
            { name: 'SAPQuery', arguments: { action: 'long_text', longText: { mode: 'discover', object: 'EKKO' } } },
          ],
        })
        .mockResolvedValueOnce({
          done: false,
          toolCalls: [
            { name: 'SAPQuery', arguments: { action: 'long_text', longText: { mode: 'read', keys: [readKey] } } },
          ],
        })
        .mockResolvedValueOnce({ done: true, content: 'I read fixture and found the requested note.' }),
    };

    const score = await runScenario(provider, scenario, []);

    expect(score.traceTurns).toHaveLength(2);
    expect(score.traceTurns?.map((turn) => turn.length)).toEqual([1, 1]);
    expect(score.tracePassed).toBe(true);
    expect(score.finalAnswerPassed).toBe(true);
    expect(score.finalAnswer).toContain('read fixture');
    expect(score.passed).toBe(true);
    const finalMessages = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[2]![0];
    expect(
      finalMessages
        .filter((message: { role: string }) => message.role === 'tool')
        .map((message: { content: string }) => message.content),
    ).toEqual(['discovery fixture', 'read fixture']);
  });

  it('fails the full trace when a forbidden tool appears after an allowed first call', async () => {
    const provider: LLMProvider = {
      name: 'scripted',
      model: 'fixture',
      chat: vi
        .fn()
        .mockResolvedValueOnce({ done: false, toolCalls: [{ name: 'SAPRead', arguments: { type: 'PROG' } }] })
        .mockResolvedValueOnce({
          done: false,
          toolCalls: [{ name: 'SAPQuery', arguments: { sql: 'SELECT * FROM STXL' } }],
        }),
    };
    const score = await runScenario(
      provider,
      {
        id: 'forbidden-later',
        description: 'Reject forbidden calls anywhere in a trace',
        category: 'read',
        prompt: 'Read safely.',
        optimal: [{ tool: 'SAPRead', requiredArgs: { type: 'PROG' } }],
        forbidden: ['SAPQuery'],
        maxToolCalls: 2,
      },
      [],
    );
    expect(score.trace.map((call) => call.name)).toEqual(['SAPRead', 'SAPQuery']);
    expect(score.tracePassed).toBe(false);
    expect(score.passed).toBe(false);
    expect(score.explanation).toContain('forbidden tool in trace: SAPQuery');
  });

  it('records forbidden parallel calls beyond the execution cap', async () => {
    const provider: LLMProvider = {
      name: 'scripted',
      model: 'fixture',
      chat: vi.fn().mockResolvedValue({
        done: false,
        toolCalls: [
          { name: 'SAPRead', arguments: { type: 'PROG', name: 'ZHELLO' } },
          { name: 'SAPWrite', arguments: { action: 'delete', name: 'ZHELLO' } },
        ],
      }),
    };
    const score = await runScenario(
      provider,
      {
        id: 'parallel-overflow-forbidden',
        description: 'Observe every proposed parallel call even at the configured cap',
        category: 'read',
        prompt: 'Read safely.',
        optimal: [{ tool: 'SAPRead', requiredArgs: { type: 'PROG' } }],
        expectedTrace: [[{ tool: 'SAPRead', requiredArgs: { type: 'PROG' } }]],
        forbidden: ['SAPWrite'],
        maxToolCalls: 1,
      },
      [],
    );
    expect(score.trace.map((call) => call.name)).toEqual(['SAPRead', 'SAPWrite']);
    expect(score.tracePassed).toBe(false);
    expect(score.explanation).toContain('forbidden tool in trace: SAPWrite');
    expect(score.passed).toBe(false);
  });

  it('passes clarification-only scenarios without tool calls and checks final-answer assertions', async () => {
    const provider: LLMProvider = {
      name: 'scripted',
      model: 'fixture',
      chat: vi.fn().mockResolvedValue({ done: true, content: 'Which language should I use, E or D?' }),
    };
    const score = await runScenario(
      provider,
      {
        id: 'clarify-language',
        description: 'Ask for missing language instead of guessing',
        category: 'read',
        prompt: 'Read the text; language was not specified.',
        optimal: [],
        noFirstCall: true,
        finalAnswer: { required: [/which language/i], forbidden: [/I assumed English/i], requireNonEmpty: true },
      },
      [],
    );
    expect(score.toolSelectionScore).toBe(1);
    expect(score.tracePassed).toBe(true);
    expect(score.finalAnswerPassed).toBe(true);
    expect(score.passed).toBe(true);
  });

  it.each([
    {
      label: 'two-character SAP language',
      longText: { mode: 'read', keys: [{ object: 'TEXT', name: 'Z_PAYMENT_NOTICE', id: 'ST', language: 'EN' }] },
      topLevel: {},
    },
    {
      label: 'unsupported read option',
      longText: {
        mode: 'read',
        keys: [{ object: 'TEXT', name: 'Z_PAYMENT_NOTICE', id: 'ST', language: 'E' }],
        phrase: 'Payment',
      },
      topLevel: {},
    },
    {
      label: 'unsupported top-level option',
      longText: { mode: 'read', keys: [{ object: 'TEXT', name: 'Z_PAYMENT_NOTICE', id: 'ST', language: 'E' }] },
      topLevel: { source: 'archive' },
    },
  ])(
    'does not give malformed stored-text calls a matching fixture response ($label)',
    async ({ longText, topLevel }) => {
      const provider: LLMProvider = {
        name: 'scripted',
        model: 'fixture',
        chat: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            toolCalls: [{ name: 'SAPQuery', arguments: { action: 'long_text', longText, ...topLevel } }],
          })
          .mockResolvedValueOnce({ done: true, content: 'The request needs correction.' }),
      };
      const score = await runScenario(
        provider,
        {
          id: 'invalid-stored-text-call',
          description: 'Reject malformed inputs before fixture routing',
          category: 'stored-text',
          prompt: 'Read the text.',
          optimal: [
            {
              tool: 'SAPQuery',
              requiredArgs: { action: 'long_text' },
              exactArgs: {
                longText: {
                  mode: 'read',
                  keys: [{ object: 'TEXT', name: 'Z_PAYMENT_NOTICE', id: 'ST', language: 'E' }],
                },
              },
            },
          ],
          expectedTrace: [
            [
              {
                tool: 'SAPQuery',
                requiredArgs: { action: 'long_text' },
                exactArgs: {
                  longText: {
                    mode: 'read',
                    keys: [{ object: 'TEXT', name: 'Z_PAYMENT_NOTICE', id: 'ST', language: 'E' }],
                  },
                },
              },
            ],
          ],
          mockToolExecutor: storedTextFixtureExecutor,
        },
        [],
      );
      const messages = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[1]![0];
      const toolOutput = messages.find((message: { role: string }) => message.role === 'tool')?.content;
      expect(toolOutput).toContain('Invalid arguments for SAPQuery');
      expect(toolOutput).not.toContain('SYNTHETIC SUCCESS FIXTURE');
      expect(score.tracePassed).toBe(false);
    },
  );

  it('fails clarification-only cases if it calls a tool and fails forbidden final-answer patterns', async () => {
    const provider: LLMProvider = {
      name: 'scripted',
      model: 'fixture',
      chat: vi
        .fn()
        .mockResolvedValueOnce({ done: false, toolCalls: [{ name: 'SAPQuery', arguments: { action: 'long_text' } }] })
        .mockResolvedValueOnce({ done: true, content: 'I assumed English.' }),
    };
    const score = await runScenario(
      provider,
      {
        id: 'clarify-language-no-guess',
        description: 'Do not guess language or read yet',
        category: 'read',
        prompt: 'Read a text with no language provided.',
        optimal: [],
        noFirstCall: true,
        finalAnswer: { required: [/which language/i], forbidden: [/I assumed English/i] },
      },
      [],
    );
    expect(score.tracePassed).toBe(false);
    expect(score.finalAnswerPassed).toBe(false);
    expect(score.passed).toBe(false);
  });
});
