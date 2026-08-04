/**
 * `ARC1_IDE_LINKS` at the dispatch layer.
 *
 * The contract that matters is structural: the link is its OWN content block. An earlier revision
 * concatenated it onto the payload, which turned every JSON tool result into unparseable text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const SOURCE = "REPORT zhello.\nWRITE: / 'Hello'.";

describe('IDE links (ARC1_IDE_LINKS)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockResolvedValue(mockResponse(200, SOURCE, { 'x-csrf-token': 'mock-csrf-token' }));
  });

  it('adds no link by default (auto, and the CLI/stdio path has no client identity)', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZHELLO' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.text).toBe(SOURCE);
  });

  it('appends the link as a separate block, leaving the payload byte-identical', async () => {
    const config = { ...DEFAULT_CONFIG, ideLinks: 'vscode' };
    const result = await handleToolCall(createClient(), config, 'SAPRead', { type: 'PROG', name: 'ZHELLO' });

    expect(result.content).toHaveLength(2);
    // The payload block must not be touched — this is what keeps JSON results parseable.
    expect(result.content[0]?.text).toBe(SOURCE);
    expect(result.content[1]?.text).toBe(
      '\nOpen ZHELLO in your IDE: vscode://marianfoo.arc1-abap-bridge/open?name=ZHELLO',
    );
  });

  it('adds nothing when the call is not about exactly one object', async () => {
    const config = { ...DEFAULT_CONFIG, ideLinks: 'vscode' };
    const result = await handleToolCall(createClient(), config, 'SAPSearch', { query: 'ZCL_*' });
    expect(result.content.some((block) => block.text.includes('in your IDE'))).toBe(false);
  });

  it('adds nothing to an error result', async () => {
    const config = { ...DEFAULT_CONFIG, ideLinks: 'vscode' };
    const result = await handleToolCall(createClient(), config, 'SAPRead', { type: 'INVALID_TYPE', name: 'X' });
    expect(result.isError).toBe(true);
    expect(result.content.some((block) => block.text.includes('in your IDE'))).toBe(false);
  });

  it('is disabled by off', async () => {
    const config = { ...DEFAULT_CONFIG, ideLinks: 'off' };
    const result = await handleToolCall(createClient(), config, 'SAPRead', { type: 'PROG', name: 'ZHELLO' });
    expect(result.content).toHaveLength(1);
  });
});
