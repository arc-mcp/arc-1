import { afterEach, expect, it, vi } from 'vitest';
import { runScenario } from '../../evals/harness.js';
import { createAnthropicProvider } from '../../evals/providers/anthropic.js';
import { createOllamaProvider } from '../../evals/providers/ollama.js';
import type { EvalScenario, LLMProvider, Message } from '../../evals/types.js';

const scenario: EvalScenario = {
  id: 'multi-call',
  description: 'Stable tool-call correlation',
  category: 'read',
  prompt: 'Inspect the source and explain it.',
  maxToolCalls: 4,
  optimal: [{ tool: 'SAPRead' }],
};
type WireMessage = {
  role: string;
  content?: string | Array<{ type: string; id?: string; tool_use_id?: string }>;
  tool_calls?: Array<{ id: string }>;
  tool_call_id?: string;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(['anthropic', 'ollama'] as const)(
  '%s preserves native IDs, parallel turns and replayed history',
  async (kind) => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'local-fixture-no-network');
    const requests: Array<{ messages: WireMessage[] }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        const turn = requests.length;
        const ids = turn === 1 ? ['native_first', 'native_parallel'] : turn === 2 ? ['native_second'] : [];
        const payload =
          kind === 'anthropic'
            ? {
                content: [
                  { type: 'text', text: 'Inspection.' },
                  ...ids.map((id) => ({
                    type: 'tool_use',
                    id,
                    name: 'SAPRead',
                    input: { type: 'PROG', name: 'ZTEST' },
                  })),
                ],
                stop_reason: ids.length ? 'tool_use' : 'end_turn',
                usage: { input_tokens: 1, output_tokens: 1 },
              }
            : {
                choices: [
                  {
                    message: {
                      content: 'Inspection.',
                      tool_calls: ids.map((id) => ({
                        id,
                        type: 'function',
                        function: { name: 'SAPRead', arguments: '{"type":"PROG","name":"ZTEST"}' },
                      })),
                    },
                    finish_reason: ids.length ? 'tool_calls' : 'stop',
                  },
                ],
              };
        return new Response(JSON.stringify(payload), { status: 200 });
      }),
    );
    const provider = kind === 'anthropic' ? createAnthropicProvider('fixture') : createOllamaProvider('fixture');
    const score = await runScenario(provider, scenario, []);
    expect(score.trace.map((call) => call.id)).toEqual(['native_first', 'native_parallel', 'native_second']);
    expect(score.passed).toBe(true);
    expect(requests).toHaveLength(3);
    const messages = requests[1]!.messages;
    const assistant = messages.filter((msg) => msg.role === 'assistant');
    expect(assistant).toHaveLength(1);
    if (kind === 'anthropic') {
      const blocks = assistant[0]!.content as Exclude<WireMessage['content'], string | undefined>;
      expect(blocks.filter((b) => b.type === 'tool_use').map((b) => b.id)).toEqual(['native_first', 'native_parallel']);
      const results = messages.at(-1)!;
      expect(results.role).toBe('user');
      expect((results.content as typeof blocks).map((b) => b.tool_use_id)).toEqual(['native_first', 'native_parallel']);
    } else {
      expect(assistant[0]!.tool_calls?.map((call) => call.id)).toEqual(['native_first', 'native_parallel']);
      expect(messages.filter((msg) => msg.role === 'tool').map((msg) => msg.tool_call_id)).toEqual([
        'native_first',
        'native_parallel',
      ]);
    }
    expect(requests[2]!.messages.slice(0, messages.length)).toEqual(messages);
  },
);

it('assigns fallback IDs once without mutating an ID-less provider response', async () => {
  const calls = [
    { name: 'SAPRead', arguments: {} },
    { name: 'SAPSearch', arguments: {} },
  ];
  const history: Message[][] = [];
  const provider: LLMProvider = {
    name: 'fixture',
    model: 'fixture',
    chat: vi.fn(async (messages) => {
      history.push(structuredClone(messages));
      return history.length < 3 ? { done: false, toolCalls: calls } : { done: true };
    }),
  };
  const score = await runScenario(provider, { ...scenario, maxToolCalls: 5 }, []);
  expect(score.trace.map((call) => call.id)).toEqual(['call_1', 'call_2', 'call_3', 'call_4']);
  expect(history[2]!.filter((m) => m.role === 'tool').map((m) => m.toolCallId)).toEqual(score.trace.map((c) => c.id));
  expect(history[2]!.slice(0, history[1]!.length)).toEqual(history[1]);
  expect(calls.every((call) => !('id' in call))).toBe(true);
});

it('does not execute parallel calls beyond the scenario allowance', async () => {
  const provider: LLMProvider = {
    name: 'fixture',
    model: 'fixture',
    chat: vi.fn().mockResolvedValue({
      done: false,
      toolCalls: [
        { name: 'SAPRead', arguments: {} },
        { name: 'SAPSearch', arguments: {} },
      ],
    }),
  };
  const liveExecutor = vi.fn().mockResolvedValue('fixture');
  const result = await runScenario(provider, { ...scenario, maxToolCalls: 1 }, [], { liveExecutor });
  expect(liveExecutor).toHaveBeenCalledExactlyOnceWith('SAPRead', {});
  expect(provider.chat).toHaveBeenCalledTimes(1);
  expect(result.toolCallCount).toBe(1);
});
