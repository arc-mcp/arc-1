import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const root = '/sap/bc/adt/functions/groups/zgroup/fmodules/z_func';
const sibling = root.replace('/z_func', '/z_sibling');
const report = readFileSync(new URL('../../fixtures/xml/syntax-check-nw750.xml', import.meta.url), 'utf8').replaceAll(
  '/sap/bc/adt/programs/programs/zarc1_test_report',
  sibling,
);
const reader = { token: 'test', clientId: 'reader', scopes: ['read'] };
const reference = (uri: string, objectName = 'Z_FUNC (Function Module)') => ({
  uri,
  objectName,
  objectType: 'FUGR/FF',
  packageName: '$TMP',
  description: '',
});
const entries = [
  { tool: 'SAPDiagnose', args: { action: 'syntax', type: 'FUNC' } },
  { tool: 'SAPRead', args: { type: 'SYNTAX', objectType: 'FUNC' } },
];
beforeEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (_url, options) =>
    mockResponse(200, options?.method === 'POST' ? report : '', { 'x-csrf-token': 't' }),
  );
});
describe('FUNC syntax routing (#1160)', () => {
  for (const entry of entries) {
    it.each([
      { label: 'stored default', options: {} },
      { label: 'stored inactive alias', options: { version: 'inactive' }, alias: true },
      {
        label: 'unsaved signature',
        options: {
          source:
            'FUNCTION Z_FUNC\n IMPORTING VALUE(iv_new) TYPE string.\n DATA lv TYPE string.\n lv = iv_new.\nENDFUNCTION.',
        },
      },
      {
        label: 'namespaced function',
        options: { version: 'active' },
        name: '/ARC/FUNC',
        uri: '/sap/bc/adt/functions/groups/%2fARC%2fGROUP/fmodules/%2fARC%2fFUNC',
      },
    ])(`${entry.tool} checks $label without writes`, async ({ options, alias, name = 'Z_FUNC', uri = root }) => {
      const client = new AdtClient({ baseUrl: 'https://sap.example', safety: defaultSafetyConfig() });
      const search = vi
        .spyOn(client, 'searchObject')
        .mockResolvedValue([reference('/sap/bc/adt/oo/classes/z_func', 'Z_FUNC'), reference(uri)]);
      const typeArgs = alias ? (entry.tool === 'SAPRead' ? { objectType: 'FUGR/FF' } : { type: 'FUGR/FF' }) : {};
      const result = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        entry.tool,
        { ...entry.args, ...typeArgs, name, ...options },
        reader,
      );
      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse(String(result.content[0]?.text));
      expect(parsed).toMatchObject({ checked: true, hasErrors: true });
      expect(parsed.messages[0].uri).toContain(sibling);
      expect(search).toHaveBeenCalledWith(name, 10, undefined, undefined);
      const posts = mockFetch.mock.calls.filter(([, o]) => o?.method === 'POST');
      expect(posts).toHaveLength(1);
      expect(String(posts[0][0])).toContain('/checkruns');
      const expected = name.startsWith('/')
        ? '/sap/bc/adt/functions/groups/%2Farc%2Fgroup/fmodules/%2Farc%2Ffunc'
        : root;
      expect(String(posts[0][1]?.body)).toContain(expected);
      expect(String(posts[0][1]?.body)).toContain(`chkrun:version="${options.version ?? 'active'}"`);
      if (options.source) expect(String(posts[0][1]?.body)).toContain(Buffer.from(options.source).toString('base64'));
      expect(mockFetch.mock.calls.every(([, o]) => ['GET', 'HEAD', 'POST'].includes(o?.method ?? 'GET'))).toBe(true);
    });
    it(`${entry.tool} reports unresolved group as not checked, without asserting absence`, async () => {
      const client = new AdtClient({ baseUrl: 'https://sap.example', safety: defaultSafetyConfig() });
      vi.spyOn(client, 'searchObject').mockResolvedValue([reference('/sap/bc/adt/oo/classes/z_func', 'Z_FUNC')]);
      const result = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        entry.tool,
        { ...entry.args, name: 'Z_FUNC' },
        reader,
      );
      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse(String(result.content[0]?.text));
      expect(parsed).toMatchObject({ checked: false, hasErrors: true });
      expect(parsed.messages[0].text).toContain('bounded search');
      expect(parsed.messages[0].text).not.toContain('was not found');
      expect(mockFetch).not.toHaveBeenCalled();
    });
    it.each([403, 500])(`${entry.tool} propagates lookup failure %s`, async (status) => {
      const client = new AdtClient({ baseUrl: 'https://sap.example', safety: defaultSafetyConfig() });
      vi.spyOn(client, 'searchObject').mockRejectedValue(new AdtApiError('lookup failed', status, '/search'));
      const result = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        entry.tool,
        { ...entry.args, name: 'Z_FUNC' },
        reader,
      );
      expect(result.isError).toBe(true);
      expect(String(result.content[0]?.text)).toContain(`status ${status}`);
      expect(mockFetch).not.toHaveBeenCalled();
    });
    it.each(['*" IMPORTING', '  *" Ordinary comment', '*" VALUE(iv) TYPE string'])(
      `${entry.tool} refuses native ignored candidate containing %s`,
      async (comment) => {
        const client = new AdtClient({ baseUrl: 'https://sap.example', safety: defaultSafetyConfig() });
        const result = await handleToolCall(
          client,
          DEFAULT_CONFIG,
          entry.tool,
          {
            ...entry.args,
            name: 'Z_FUNC',
            source: `FUNCTION Z_FUNC.\n${comment}\n invalid_statement.\nENDFUNCTION.`,
          },
          reader,
        );
        expect(result.isError).not.toBe(true);
        const parsed = JSON.parse(String(result.content[0]?.text));
        expect(parsed).toMatchObject({ checked: false, hasErrors: true });
        expect(parsed.messages[0].text).toContain('SAP GUI');
        expect(mockFetch).not.toHaveBeenCalled();
      },
    );
    it(`${entry.tool} retains the syntax deny-action boundary`, async () => {
      const client = new AdtClient({ baseUrl: 'https://sap.example', safety: defaultSafetyConfig() });
      const result = await handleToolCall(
        client,
        { ...DEFAULT_CONFIG, denyActions: ['SAPDiagnose.syntax'] },
        entry.tool,
        { ...entry.args, name: 'Z_FUNC' },
        reader,
      );
      expect(result.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  }
});
