import { afterEach, describe, expect, it, vi } from 'vitest';
import { runScenario } from '../../evals/harness.js';
import { createAnthropicProvider } from '../../evals/providers/anthropic.js';
import { createOllamaProvider } from '../../evals/providers/ollama.js';
import type { EvalScenario, LLMProvider } from '../../evals/types.js';

const scenario: EvalScenario = {
  id: 'cancellation',
  description: 'Stop the scenario after cancellation',
  category: 'read',
  prompt: 'Read source.',
  optimal: [{ tool: 'SAPRead' }],
  maxToolCalls: 3,
};
const calls = [
  { name: 'SAPRead', arguments: { type: 'PROG', name: 'Z_FIRST' } },
  { name: 'SAPRead', arguments: { type: 'PROG', name: 'Z_SECOND' } },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('eval cancellation', () => {
  it('rejects an already-cancelled scenario before contacting the model or tools', async () => {
    const controller = new AbortController();
    const reason = new Error('Cancelled before model request');
    controller.abort(reason);
    const provider: LLMProvider = { name: 'fixture', model: 'fixture', chat: vi.fn() };
    const execute = vi.fn();
    await expect(
      runScenario(provider, { ...scenario, mockToolExecutor: execute }, [], { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(provider.chat).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['ollama', 'anthropic'] as const)(
    'aborts the pending %s HTTP generation and makes no subsequent call',
    async (kind) => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'unit-test-no-network');
      const controller = new AbortController();
      const reason = new Error('Generation timed out');
      const fetch = vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) throw new Error('Expected generation cancellation signal');
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
      );
      vi.stubGlobal('fetch', fetch);
      const provider = kind === 'ollama' ? createOllamaProvider('fixture') : createAnthropicProvider('fixture');
      const chat = vi.spyOn(provider, 'chat');
      const execute = vi.fn();
      const pending = runScenario(provider, { ...scenario, mockToolExecutor: execute }, [], {
        signal: controller.signal,
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0][1]?.signal).toBe(controller.signal);
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      expect(chat).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('does not execute tools from a provider response that arrives after cancellation', async () => {
    const controller = new AbortController();
    const reason = new Error('Late model response');
    const provider: LLMProvider = {
      name: 'fixture',
      model: 'fixture',
      chat: vi.fn(async () => {
        controller.abort(reason);
        return { done: false, toolCalls: calls };
      }),
    };
    const execute = vi.fn();
    await expect(
      runScenario(provider, { ...scenario, mockToolExecutor: execute }, [], { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(execute).not.toHaveBeenCalled();
    expect(provider.chat).toHaveBeenCalledOnce();
  });

  it.each(['mock', 'live'] as const)('stops remaining parallel %s tools and the next model turn', async (backend) => {
    const controller = new AbortController();
    const reason = new Error('Cancelled during tool execution');
    const provider: LLMProvider = {
      name: 'fixture',
      model: 'fixture',
      chat: vi.fn().mockResolvedValue({ done: false, toolCalls: calls }),
    };
    const execute = vi.fn(async () => {
      controller.abort(reason);
      if (backend === 'live') throw reason;
      return 'fixture output';
    });
    await expect(
      runScenario(provider, backend === 'mock' ? { ...scenario, mockToolExecutor: execute } : scenario, [], {
        signal: controller.signal,
        ...(backend === 'live' ? { liveExecutor: execute } : {}),
      }),
    ).rejects.toBe(reason);
    expect(execute).toHaveBeenCalledOnce();
    expect(provider.chat).toHaveBeenCalledOnce();
    expect((provider.chat as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(3);
  });

  it('retains two-argument provider calls when no cancellation option was supplied', async () => {
    const provider: LLMProvider = {
      name: 'fixture',
      model: 'fixture',
      chat: vi.fn().mockResolvedValue({ done: true, content: 'Which source?' }),
    };
    await runScenario(provider, { ...scenario, optimal: [], noFirstCall: true }, [], { signal: undefined });
    expect((provider.chat as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(2);
  });
});
