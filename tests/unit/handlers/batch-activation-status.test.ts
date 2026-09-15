import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { buildBatchActivationStatuses, formatBatchActivationStatuses } = await import(
  '../../../src/handlers/activate.js'
);
const devtools = await import('../../../src/adt/devtools.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const objects = ['ZFIRST', 'ZFIRST2'].map((name) => ({ type: 'INTF', name, url: `/sap/bc/adt/oo/interfaces/${name}` }));

describe('batch activation status attribution', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });
  it.each(['', '/source/main#start=3,1', '/'])('matches a diagnostic at an object boundary: %s', (suffix) => {
    const result = buildBatchActivationStatuses(objects, {
      success: false,
      messages: ['Broken second object'],
      details: [{ severity: 'error', text: 'Broken second object', uri: `${objects[1].url.toLowerCase()}${suffix}` }],
    });
    expect(result.map((row) => row.status)).toEqual(['unknown', 'error']);
    expect(result[0].messages).toEqual([]);
    expect(result[1].messages.join()).toContain('Broken second object');
  });
  it('never calls unreported objects active after a failed batch', () => {
    const result = buildBatchActivationStatuses(objects, { success: false, messages: [], details: [] });
    expect(result.map((row) => row.status)).toEqual(['unknown', 'unknown']);
    expect(formatBatchActivationStatuses(result)).toContain('ZFIRST (INTF): unknown');
  });
  it('keeps warnings without implying successful activation', () => {
    const result = buildBatchActivationStatuses(objects, {
      success: false,
      messages: [],
      details: [
        { severity: 'warning', text: 'Own warning', uri: objects[0].url },
        { severity: 'error', text: 'Cancelled' },
      ],
    });
    expect(result[0]).toMatchObject({ status: 'unknown' });
    expect(result[0].messages.join()).toContain('Own warning');
    expect(result[0].messages.join()).not.toContain('Cancelled');
    expect(formatBatchActivationStatuses(result)).toContain('ZFIRST (INTF): unknown');
  });
  it('retains successful and warning outcomes after confirmed batch success', () => {
    const result = buildBatchActivationStatuses(objects, {
      success: true,
      messages: [],
      details: [{ severity: 'warning', text: 'Warning', uri: objects[1].url }],
    });
    expect(result.map((row) => row.status)).toEqual(['active', 'warning']);
  });
  it.each([true, false])('retains flat-only global messages (success=%s)', async (success) => {
    mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
    vi.spyOn(devtools, 'activateBatch').mockResolvedValue({ success, messages: ['Global status'], details: [] });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', { objects });
    expect(result.isError === true).toBe(!success);
    expect(result.content[0].text.match(/Global status/g)).toHaveLength(1);
    expect(result.content[0].text).toContain('Messages: Global status');
    expect(result.content[0].text).toContain(`ZFIRST (INTF): ${success ? 'active' : 'unknown'}`);
  });
  it.each(['info', 'warning'] as const)(
    'retains global %s details and unrelated flat messages without duplicates',
    async (severity) => {
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      vi.spyOn(devtools, 'activateBatch').mockResolvedValue({
        success: false,
        messages: ['Own error', 'Global detail', 'Additional status', 'Additional status'],
        details: [
          { severity: 'error', text: 'Own error', uri: objects[1].url },
          { severity, text: 'Global detail' },
        ],
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', { objects });
      for (const message of ['Own error', 'Global detail', 'Additional status']) {
        expect(result.content[0].text.split(message)).toHaveLength(2);
      }
      expect(result.content[0].text).toContain('ZFIRST (INTF): unknown');
      expect(result.content[0].text).toContain('ZFIRST2 (INTF): error');
    },
  );

  it('shows a global cancellation once without attaching it to the first object', async () => {
    mockFetch.mockImplementation(async (url, options) =>
      mockResponse(
        200,
        options?.method === 'POST' && new URL(String(url)).pathname === '/sap/bc/adt/activation'
          ? '<messages><msg severity="error" shortText="Activation was cancelled."/></messages>'
          : '',
        { 'x-csrf-token': 'T' },
      ),
    );
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', { objects });
    expect(result.isError).toBe(true);
    expect(result.content[0].text.match(/Activation was cancelled\./g)).toHaveLength(1);
    expect(result.content[0].text).toContain('ZFIRST (INTF): unknown');
    expect(result.content[0].text).toContain('ZFIRST2 (INTF): unknown');
  });
});
