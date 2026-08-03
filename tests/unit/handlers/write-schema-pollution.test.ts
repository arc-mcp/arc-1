/**
 * SAPWrite schema-pollution regression tests (issues #360, #664) — end-to-end through
 * `handleToolCall`, i.e. scope → arg normalization → Zod → handler, not the normalizer alone.
 *
 * A strict-mode caller (OpenAI/GPT structured outputs, and the MCP clients emulating it) must emit
 * a value for every advertised schema property. `SAPWrite` has no `null` form by default (#526), so
 * such a caller fabricates values for fields its call has nothing to do with. Those calls must still
 * do what the caller asked for.
 *
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

describe('fabricated FUNC processing metadata does not block unrelated writes (issue #664)', () => {
  const POLLUTION_ERROR = 'processingType and updateTaskKind are only supported';

  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockResolvedValue(
      mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'.", { 'x-csrf-token': 'mock-csrf-token' }),
    );
  });

  it('creates a PROG despite fabricated processing metadata, and never sends it to SAP', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'PROG',
      name: 'ZPLU_HELLO_WORLD',
      package: '$TMP',
      description: 'Hello World report',
      source: "REPORT zplu_hello_world.\n\nWRITE: / 'Hello World'.",
      processingType: 'normal',
      updateTaskKind: 'startImmediate',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toContain('Created PROG ZPLU_HELLO_WORLD');
    const bodies = (mockFetch.mock.calls as [string, { body?: string }][]).map(([, o]) => o?.body ?? '');
    expect(bodies.some((b) => b.includes('processingType') || b.includes('updateTaskKind'))).toBe(false);
  });

  it('accepts a batch_create whose items carry fabricated metadata', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'batch_create',
      objects: [
        {
          type: 'PROG',
          name: 'ZPLU664_P',
          source: 'REPORT zplu664_p.',
          package: '$TMP',
          processingType: 'normal',
          updateTaskKind: 'startImmediate',
        },
      ],
    });
    expect(result.content[0]?.text).not.toContain(POLLUTION_ERROR);
  });

  it('still refuses a batch FUNC item asking for update without a task kind', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'batch_create',
      objects: [{ type: 'FUNC', name: 'Z_PLU664_FM', group: 'ZPLU664_FG', processingType: 'update' }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('requires an explicit updateTaskKind');
  });
});
