/**
 * Anthropic LLM provider — uses Claude API directly.
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 * Supports Claude Sonnet, Haiku, and Opus models.
 *
 * Usage:
 *   const provider = createAnthropicProvider('claude-sonnet-4-20250514');
 *   const response = await provider.chat(messages, tools);
 */

import type { LLMProvider, LLMResponse, LLMToolCall, Message, ToolDefinitionForLLM } from '../types.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/** Default model. Claude Haiku 4.5 — fast + strong tool calling. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

/** Lazy so .env loaded by the test entry is picked up. */
function getAnthropicApiKey(): string {
  return process.env.ANTHROPIC_API_KEY ?? '';
}

/** Convert our Message format to Anthropic Messages API format */
function toAnthropicMessages(messages: Message[]): {
  system?: string;
  messages: Array<Record<string, unknown>>;
} {
  let system: string | undefined;
  const apiMessages: Array<Record<string, unknown>> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = msg.content;
      continue;
    }

    if (msg.role === 'tool') {
      const result = { type: 'tool_result', tool_use_id: msg.toolCallId, content: msg.content ?? '' };
      const previous = apiMessages.at(-1);
      if (previous?.role === 'user' && Array.isArray(previous.content)) {
        previous.content.push(result);
      } else {
        apiMessages.push({ role: 'user', content: [result] });
      }
      continue;
    }

    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      const content: Array<Record<string, unknown>> = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      apiMessages.push({ role: 'assistant', content });
      continue;
    }

    apiMessages.push({
      role: msg.role,
      content: msg.content ?? '',
    });
  }

  return { system, messages: apiMessages };
}

/** Convert ARC-1 tool definitions to Anthropic tool format */
function toAnthropicTools(tools: ToolDefinitionForLLM[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

export function createAnthropicProvider(model: string): LLMProvider {
  return {
    name: 'anthropic',
    model,

    async chat(messages: Message[], tools: ToolDefinitionForLLM[]): Promise<LLMResponse> {
      const apiKey = getAnthropicApiKey();
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY not set (add it to .env)');
      }

      const { system, messages: apiMessages } = toAnthropicMessages(messages);

      const body: Record<string, unknown> = {
        model,
        max_tokens: 1024,
        messages: apiMessages,
      };
      if (system) body.system = system;
      if (tools.length > 0) body.tools = toAnthropicTools(tools);

      const resp = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Anthropic API error ${resp.status}: ${text}`);
      }

      const data = (await resp.json()) as {
        content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
        stop_reason: string;
        usage: { input_tokens: number; output_tokens: number };
      };

      let content: string | undefined;
      const toolCalls: LLMToolCall[] = [];

      for (const block of data.content) {
        if (block.type === 'text' && block.text) {
          content = (content ?? '') + block.text;
        } else if (block.type === 'tool_use' && block.name && block.input) {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input,
          });
        }
      }

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        },
        done: data.stop_reason !== 'tool_use',
      };
    },
  };
}

/** Check if Anthropic API key is configured */
export function checkAnthropicAvailable(): { available: boolean; reason?: string } {
  if (!getAnthropicApiKey()) {
    return { available: false, reason: 'ANTHROPIC_API_KEY not set (add it to .env)' };
  }
  return { available: true };
}
