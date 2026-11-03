import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtNetworkError } from '../../../src/adt/errors.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const path = '/sap/bc/adt/programs/programs/RSUSR002/variants';
const input = { type: 'VARIANTS', name: 'RSUSR002' };

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

describe('SAPRead program variants', () => {
  it.each(['No suitable resource found', 'Keine geeignete Ressource gefunden'])(
    'reports an unavailable resource for %s',
    async (body) => {
      mockFetch.mockResolvedValue(mockResponse(404, body));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', input);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/program.variant/i);
      expect(result.content[0]?.text).toContain('404');
      expect(result.content[0]?.text).not.toMatch(/SICF|Handler List|3128830/);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(String(mockFetch.mock.calls[0]?.[0])).toContain(path);
    },
  );

  it('preserves successful responses from a backend that serves the resource', async () => {
    const body = '<variants><variant name="EXAMPLE"/></variants>';
    mockFetch.mockResolvedValue(mockResponse(200, body));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', input);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(body);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 429, 500])('preserves the public HTTP %i failure without data fallback', async (status) => {
    mockFetch.mockResolvedValue(mockResponse(status, 'Native failure'));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', input);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(String(status));
    expect(result.content[0]?.text).not.toContain('program-variant ADT resource');
    expect(mockFetch.mock.calls.every((call) => String(call[0]).includes(path))).toBe(true);
    expect(mockFetch.mock.calls.every((call) => (call[1]?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('preserves a network failure through the public handler', async () => {
    const client = createClient();
    const get = vi.spyOn(client.http, 'get').mockRejectedValue(new AdtNetworkError('Connection refused'));
    const post = vi.spyOn(client.http, 'post');
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', input);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('network error');
    expect(result.content[0]?.text).not.toContain('program-variant ADT resource');
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('keeps minimal-errors output free of diagnostic details', async () => {
    mockFetch.mockResolvedValue(mockResponse(404, 'No suitable resource found'));
    const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors: true }, 'SAPRead', input);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Category: program-variants-unavailable');
    expect(result.content[0]?.text).not.toMatch(/No suitable resource|SICF|RSUSR002/);
  });
});
