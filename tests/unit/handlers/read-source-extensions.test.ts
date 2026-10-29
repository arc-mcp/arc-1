import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/extensions/source/${name}`, import.meta.url), 'utf8');
const source = 'REPORT enh_nested_demo.\r\nWRITE / 1.\r\n';
const args = { type: 'PROG', name: 'ENH_NESTED_DEMO', version: 'active' };
const pathOf = (raw: unknown) => new URL(String(raw)).pathname.toLowerCase();
const optionalCalls = () =>
  mockFetch.mock.calls.filter((c) => !pathOf(c[0]).includes('discovery') && !pathOf(c[0]).endsWith('/source/main'));
const summaryOf = (result: { content: Array<{ text: string }> }) =>
  JSON.parse(result.content[1]!.text.replace('[extensions] ', ''));
beforeEach(() => {
  vi.resetAllMocks();
  setCachedFeatures(featuresOff());
  mockFetch.mockImplementation(async (raw) => {
    const path = pathOf(raw);
    if (path.includes('discovery')) return mockResponse(200, '<service/>', { 'x-csrf-token': 'test' });
    if (path.endsWith('/source/main/enhancements')) return mockResponse(200, fixture('nested-750.xml'));
    if (path.endsWith('/source/main')) return mockResponse(200, source);
    if (path.endsWith('/programs/enh_nested_demo')) return mockResponse(200, fixture('prog-metadata-npl.xml'));
    throw new Error('Unexpected handler test path');
  });
});
describe('SAPRead source plug-in integration', () => {
  it('preserves the first block exactly, defaults full PROG to summary, and leaves none unchanged', async () => {
    const client = createClient();
    const none = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', { ...args, extensions: 'none' });
    expect(none).toMatchObject({ content: [{ type: 'text', text: source }] });
    expect(none.content).toHaveLength(1);
    expect(optionalCalls()).toHaveLength(0);
    const summary = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', args);
    expect(summary.content[0]).toEqual(none.content[0]);
    expect(summaryOf(summary).identities).toHaveLength(4);
    expect(summary.content).toHaveLength(2);
  });
  it('returns plug-in bodies as separate labelled blocks and never splices base source', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { ...args, extensions: 'sources' });
    expect(result.content[0]?.text).toBe(source);
    expect(result.content).toHaveLength(7);
    expect(result.content[2]?.text).toContain('[extension graph]');
    expect(result.content.slice(3).every((b) => b.text.includes('representation=rendered_plugin_source'))).toBe(true);
    expect(mockFetch.mock.calls.filter((c) => pathOf(c[0]).endsWith('/source/main'))).toHaveLength(1);
  });
  it.each([{ grep: 'WRITE' }, { lineStart: 1, lineEnd: 1 }])(
    'defaults a filtered base read to none: %s',
    async (partial) => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { ...args, ...partial });
      expect(result.content).toHaveLength(1);
      expect(optionalCalls()).toHaveLength(0);
    },
  );
  it('labels explicit filtered-read discovery as owning-source coverage', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      ...args,
      grep: 'WRITE',
      extensions: 'summary',
    });
    expect(result.content[0]?.text).toContain('WRITE / 1.');
    expect(summaryOf(result).scope).toContain('owning');
    expect(summaryOf(result).identities).toHaveLength(4);
  });
  it('preserves successful base source after an optional terminal authorization failure', async () => {
    mockFetch.mockImplementation(async (raw) =>
      pathOf(raw).endsWith('/source/main') ? mockResponse(200, source) : mockResponse(401, 'sensitive backend error'),
    );
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', args);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(source);
    expect(summaryOf(result).providers[0].status).toBe('denied');
    expect(JSON.stringify(result)).not.toContain('sensitive backend error');
  });
  it('rejects active extension substitution for an inactive base', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      ...args,
      version: 'inactive',
      extensions: 'sources',
    });
    expect(result.isError).toBeUndefined();
    expect(summaryOf(result).providers[0]).toMatchObject({ status: 'unsupported', reason: 'unsupported_version' });
    expect(mockFetch.mock.calls.some((c) => pathOf(c[0]).includes('/enhancements'))).toBe(false);
  });
  it('carries the function group already resolved by the ordinary base read', async () => {
    const client = createClient();
    const resolve = vi.spyOn(client, 'resolveFunctionGroup').mockResolvedValue('SAPBC_GLOBAL_FIS');
    mockFetch.mockImplementation(async (raw) => {
      const path = pathOf(raw);
      if (path.endsWith('/source/main/enhancements/elements')) return mockResponse(200, fixture('function-758.xml'));
      if (path.endsWith('/source/main')) return mockResponse(200, fixture('function.abap'));
      if (path.endsWith('/fmodules/sapbc_global_cancel_update'))
        return mockResponse(200, fixture('func-metadata-a4h.xml'));
      throw new Error('Unexpected function test path');
    });
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
      type: 'FUNC',
      name: 'SAPBC_GLOBAL_CANCEL_UPDATE',
      version: 'active',
      extensions: 'sources',
    });
    expect(result.isError).toBeUndefined();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result.content[0]?.text).toBe(fixture('function.abap'));
    expect(summaryOf(result).identities[0].name).toBe('/SMFND/DEMO_DEL_BOOKING');
    expect(result.content.find((b) => b.text.startsWith('[extension source'))?.text).toContain('syclo');
  });
});
