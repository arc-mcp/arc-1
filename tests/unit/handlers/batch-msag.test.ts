import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const transportModule = await import('../../../src/adt/transport.js');
const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
const objectPath = '/sap/bc/adt/messageclass/ZMESSAGES';
const messages = [
  { number: '001', shortText: 'First &1 <check>' },
  { number: '002', shortText: 'Second message' },
];
const messageClass = { type: 'MSAG', name: 'ZMESSAGES', messages };
const program = (name: string) => ({ type: 'PROG', name, source: `REPORT ${name.toLowerCase()}.` });
const ok = () =>
  mockResponse(200, '<asx:values><LOCK_HANDLE>LH</LOCK_HANDLE><CORRNR>A4HK900002</CORRNR></asx:values>', {
    'x-csrf-token': 'T',
  });

function calls() {
  return mockFetch.mock.calls.map(([url, options]) => ({
    url: new URL(String(url)),
    method: options?.method ?? 'GET',
    body: String(options?.body ?? ''),
    headers: options?.headers,
  }));
}

function run(objects: Record<string, unknown>[], activateAtEnd = false) {
  return handleToolCall(createClient(), { ...config, minimalErrors: true }, 'SAPWrite', {
    action: 'batch_create',
    package: '$TMP',
    objects,
    activateAtEnd,
  });
}

describe('MSAG batch message persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    resetCachedFeatures();
    mockFetch.mockImplementation(() => Promise.resolve(ok()));
  });

  it.each([false, true])('writes messages before activation (activateAtEnd=%s)', async (activateAtEnd) => {
    const result = await run([messageClass], activateAtEnd);
    expect(result.isError).toBeFalsy();
    const sequence = calls();
    const create = sequence.findIndex((c) => c.method === 'POST' && c.url.pathname === '/sap/bc/adt/messageclass');
    const lock = sequence.findIndex(
      (c) => c.url.pathname === objectPath && c.url.searchParams.get('_action') === 'LOCK',
    );
    const put = sequence.findIndex((c) => c.url.pathname === objectPath && c.method === 'PUT');
    const unlock = sequence.findIndex(
      (c) => c.url.pathname === objectPath && c.url.searchParams.get('_action') === 'UNLOCK',
    );
    const activate = sequence.findIndex((c) => c.url.pathname === '/sap/bc/adt/activation');
    expect(create).toBeGreaterThanOrEqual(0);
    expect(lock).toBeGreaterThan(create);
    expect(put).toBeGreaterThan(lock);
    expect(unlock).toBeGreaterThan(put);
    expect(activate).toBeGreaterThan(unlock);
    expect(sequence[put].body).toContain('First &amp;1 &lt;check&gt;');
    expect(sequence[put].body).toContain('Second message');
    expect(sequence[put].headers['Content-Type']).toBe('application/vnd.sap.adt.mc.messageclass+xml');
    expect(sequence[put].url.searchParams.get('lockHandle')).toBe('LH');
    expect(sequence[put].url.searchParams.get('corrNr')).toBe('A4HK900002');
    expect(sequence[unlock].url.searchParams.get('lockHandle')).toBe('LH');
  });

  it.each([undefined, []])('does not lock or PUT an empty message class (%s)', async (value) => {
    const result = await run([{ type: 'MSAG', name: 'ZMESSAGES', messages: value }]);
    expect(result.isError).toBeFalsy();
    expect(calls().filter((c) => c.method === 'PUT' || c.url.searchParams.get('_action') === 'LOCK')).toEqual([]);
  });

  it('prefers the requested transport to the lock response transport', async () => {
    vi.spyOn(transportModule, 'getTransport').mockResolvedValue({
      id: 'A4HK900001',
      description: 'Request',
      owner: 'TEST',
      status: 'D',
      type: 'K',
      tasks: [],
    });
    const result = await run([{ ...messageClass, transport: 'A4HK900001' }]);
    expect(result.isError).toBeFalsy();
    const put = calls().find((c) => c.method === 'PUT' && c.url.pathname === objectPath);
    expect(put).toBeDefined();
    expect(put?.url.searchParams.get('corrNr')).toBe('A4HK900001');
  });

  it.each([false, true])('retains the shell and stops after PUT failure (activateAtEnd=%s)', async (activateAtEnd) => {
    mockFetch.mockImplementation((url, options) =>
      Promise.resolve(
        new URL(String(url)).pathname === objectPath && options?.method === 'PUT'
          ? mockResponse(400, 'PRIVATE_SAP_DETAIL', { 'x-csrf-token': 'T' })
          : ok(),
      ),
    );
    const result = await run([program('ZFIRST'), messageClass, program('ZLAST')], activateAtEnd);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SAP_DETAIL');
    const { batch } = JSON.parse(result.content[1].text);
    expect(batch).toMatchObject({ created: 2, completed: 1, failed: 1, skipped: 1 });
    expect(batch.results[1]).toMatchObject({
      creation: 'confirmed',
      write: 'unknown',
      activation: 'not_attempted',
      failedPhase: 'write',
    });
    expect(batch.results[2]).toMatchObject({ creation: 'not_attempted', status: 'skipped' });
    const sequence = calls();
    expect(
      sequence.filter((c) => c.url.pathname === objectPath && c.url.searchParams.get('_action') === 'UNLOCK'),
    ).toHaveLength(1);
    const activations = sequence.filter((c) => c.url.pathname === '/sap/bc/adt/activation');
    expect(activations).toHaveLength(1);
    expect(activations[0].body).toContain('ZFIRST');
    expect(activations[0].body).not.toContain('ZMESSAGES');
    expect(
      sequence.filter((c) => c.url.pathname === '/sap/bc/adt/programs/programs' && c.method === 'POST'),
    ).toHaveLength(1);
  });

  it('reports a lock failure after creation without PUT, unlock or activation', async () => {
    mockFetch.mockImplementation((url) =>
      Promise.resolve(
        new URL(String(url)).searchParams.get('_action') === 'LOCK'
          ? mockResponse(403, 'PRIVATE_SAP_DETAIL', { 'x-csrf-token': 'T' })
          : ok(),
      ),
    );
    const result = await run([messageClass, program('ZLAST')]);
    expect(result.isError).toBe(true);
    const { batch } = JSON.parse(result.content[1].text);
    expect(batch.results[0]).toMatchObject({
      creation: 'confirmed',
      write: 'unknown',
      activation: 'not_attempted',
      failedPhase: 'write',
    });
    expect(batch.results[1]).toMatchObject({ creation: 'not_attempted', status: 'skipped' });
    expect(
      calls().filter(
        (c) =>
          c.method === 'PUT' ||
          c.url.searchParams.get('_action') === 'UNLOCK' ||
          c.url.pathname === '/sap/bc/adt/activation',
      ),
    ).toEqual([]);
  });
});
