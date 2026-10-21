import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtNetworkError } from '../../../src/adt/errors.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { classifyMultiTargetSapError, handleToolCall } = await import('../../../src/handlers/dispatch.js');

beforeEach(() => vi.resetAllMocks());

describe('network error guidance', () => {
  it.each([
    ['TimeoutError', 'exceeded its client time limit'],
    ['AbortError', 'was cancelled'],
  ])('does not label %s as a connectivity failure', async (name, expected) => {
    mockFetch.mockRejectedValue(new DOMException('stopped', name));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZTEST' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(expected);
    expect(result.content[0]?.text).not.toMatch(/Cannot reach|connectivity probe/i);
  });

  it.each(['TimeoutError', 'AbortError'])('retains activation recovery guidance for %s', async (name) => {
    for (const minimalErrors of [false, true]) {
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'token' }));
      mockFetch.mockRejectedValueOnce(new DOMException('private-sentinel', name));
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPActivate', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('If activation was submitted');
      expect(result.content[0]?.text).toContain('completion is unconfirmed');
      expect(result.content[0]?.text).toContain('INACTIVE_OBJECTS');
      expect(result.content[0]?.text).toContain('force_refresh=true');
      expect(result.content[0]?.text).not.toMatch(/Cannot reach|Successfully activated/);
      if (minimalErrors) expect(result.content[0]?.text).not.toContain('private-sentinel');
    }
  });

  it.each([429, 500, 503])(
    'requires inspection after activation HTTP %i, including minimal-error mode',
    async (status) => {
      for (const minimalErrors of [false, true]) {
        mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'token' }));
        mockFetch.mockResolvedValueOnce(mockResponse(status, 'private-sentinel'));
        const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPActivate', {
          type: 'PROG',
          name: 'ZTEST',
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain('completion is unconfirmed');
        expect(result.content[0]?.text).toContain('INACTIVE_OBJECTS');
        expect(result.content[0]?.text).not.toMatch(/wait 10-30 seconds and retry|Cannot reach/);
        if (minimalErrors) expect(result.content[0]?.text).not.toContain('private-sentinel');
      }
    },
  );

  it.each(['TimeoutError', 'AbortError'])('keeps multi-target %s errors safe and distinct', (name) => {
    const error = new AdtNetworkError('private-sentinel', new DOMException('private-sentinel', name));
    const result = classifyMultiTargetSapError(error, 'A4H/001', 'SAPRead');
    expect(result).toMatchObject({ code: 'SAP_REQUEST_FAILED', retryable: false });
    expect(result?.message).toContain('A4H/001');
    expect(result?.message).toContain(name === 'TimeoutError' ? 'client time limit' : 'cancelled');
    expect(result?.message).not.toMatch(/could not reach|try again now|private-sentinel/);
  });

  it('retains connectivity guidance for connection errors containing timeout text', async () => {
    mockFetch.mockRejectedValue(new Error('connect ETIMEDOUT: connection timeout'));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZTEST' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Cannot reach the SAP system');
    expect(result.content[0]?.text).not.toContain('client time limit');
  });
});
