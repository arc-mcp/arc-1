import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
const objectPath = '/sap/bc/adt/messageclass/ZMESSAGES';
const ok = () => mockResponse(200, '<asx:values><LOCK_HANDLE>LH</LOCK_HANDLE></asx:values>', { 'x-csrf-token': 'T' });

function calls() {
  return mockFetch.mock.calls.map(([url, options]) => ({
    url: new URL(String(url)),
    method: options?.method ?? 'GET',
    body: String(options?.body ?? ''),
  }));
}

function write(action: 'create' | 'batch_create' | 'update', number: string) {
  const msag = { type: 'MSAG', name: 'ZMESSAGES', messages: [{ number, shortText: 'Text' }] };
  return handleToolCall(createClient(), config, 'SAPWrite', {
    action,
    ...(action === 'update' ? {} : { package: '$TMP' }),
    ...(action === 'batch_create' ? { objects: [msag] } : msag),
  });
}

// SAP rejects an invalid number only in the follow-up PUT, after the create POST has already left an
// empty message class in the transport (#1254). Eclipse ADT refuses such numbers on the client.
describe('MSAG message number validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    resetCachedFeatures();
    mockFetch.mockImplementation(() => Promise.resolve(ok()));
  });

  describe.each(['create', 'batch_create', 'update'] as const)('%s', (action) => {
    it.each(['', 'ABC', '1000', '1a', ' 01', '-1'])('refuses number "%s" before any SAP call', async (number) => {
      const result = await write(action, number);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('number');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  it.each(['create', 'batch_create'] as const)('%s names the accepted format', async (action) => {
    const result = await write(action, 'ABC');
    expect(result.content[0].text).toContain('Message number must be 1-3 digits (000-999)');
  });

  it.each(['0', '1', '01', '001', '999'])('create passes number "%s" unchanged to SAP', async (number) => {
    const result = await write('create', number);
    expect(result.isError).toBeFalsy();
    const put = calls().find((c) => c.method === 'PUT' && c.url.pathname === objectPath);
    expect(put?.body).toContain(`mc:msgno="${number}"`);
  });

  it.each([400, 500])('create reports recovery when the message PUT returns %i', async (status) => {
    mockFetch.mockImplementation((url, options) =>
      Promise.resolve(
        new URL(String(url)).pathname === objectPath && options?.method === 'PUT'
          ? mockResponse(status, 'Message save failed', { 'x-csrf-token': 'T' })
          : ok(),
      ),
    );
    const result = await write('create', '001');
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain('MSAG ZMESSAGES was created, but writing its messages failed');
    expect(text).toContain('SAPWrite(action="update", type="MSAG", name="ZMESSAGES"');
    expect(text).toContain('do not repeat create');
    expect(text).not.toContain('seconds and retry');
    const sequence = calls();
    expect(sequence.filter((c) => c.method === 'POST' && c.url.pathname === '/sap/bc/adt/messageclass')).toHaveLength(
      1,
    );
    expect(
      sequence.filter((c) => c.url.pathname === objectPath && c.url.searchParams.get('_action') === 'UNLOCK'),
    ).toHaveLength(1);
  });
});
