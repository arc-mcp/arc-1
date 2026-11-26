import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const structural = '/sap/bc/adt/functions/groups/zarc1/includes/lzarc1f01';
const report = readFileSync(new URL('../../fixtures/xml/syntax-check-nw750.xml', import.meta.url), 'utf8').replaceAll(
  '/sap/bc/adt/programs/programs/zarc1_test_report',
  structural,
);
const reader = { token: 'test', clientId: 'reader', scopes: ['read'] };
const match = (objectType: string, uri: string) => ({ objectType, objectName: 'LZARC1F01', uri });
const entries = [
  { tool: 'SAPDiagnose', args: { action: 'syntax', type: 'INCL' } },
  { tool: 'SAPRead', args: { type: 'SYNTAX', objectType: 'INCL' } },
];
const posts = () => mockFetch.mock.calls.filter(([, o]) => o?.method === 'POST');
const newClient = () => new AdtClient({ baseUrl: 'https://sap.example', safety: defaultSafetyConfig() });

beforeEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (_url, options) =>
    mockResponse(200, options?.method === 'POST' ? report : '', { 'x-csrf-token': 't' }),
  );
});

describe('INCL syntax routing', () => {
  for (const entry of entries) {
    it.each([
      { label: 'stored default', options: {} },
      { label: 'stored inactive', options: { version: 'inactive' } },
      { label: 'unsaved source', options: { source: 'FORM f01.\n  gv_global = 1.\nENDFORM.' } },
    ])(`${entry.tool} checks a function-group include at its structural URI ($label)`, async ({ options }) => {
      const client = newClient();
      const lookup = vi
        .spyOn(client, 'lookupObjects')
        .mockResolvedValue([{ name: 'LZARC1F01', found: true, matches: [match('FUGR/I', structural)] }] as never);
      const result = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        entry.tool,
        { ...entry.args, name: 'LZARC1F01', ...options },
        reader,
      );
      expect(result.isError).not.toBe(true);
      expect(JSON.parse(String(result.content[0]?.text))).toMatchObject({ checked: true, hasErrors: true });
      expect(lookup).toHaveBeenCalledWith(['LZARC1F01']);
      expect(posts()).toHaveLength(1);
      const body = String(posts()[0][1]?.body);
      expect(body).toContain(`adtcore:uri="${structural}"`);
      expect(body).not.toContain('/programs/includes/');
      expect(body).toContain(`chkrun:version="${'version' in options ? options.version : 'active'}"`);
      if ('source' in options) {
        expect(body).toContain(`chkrun:uri="${structural}/source/main"`);
        expect(body).toContain(Buffer.from(String(options.source)).toString('base64'));
        // The existence probe before an unsaved-source check uses the same structural URI.
        const gets = mockFetch.mock.calls.filter(([, o]) => (o?.method ?? 'GET') === 'GET').map(([u]) => String(u));
        expect(gets.some((u) => u.includes(structural))).toBe(true);
      }
      expect(mockFetch.mock.calls.every(([, o]) => ['GET', 'HEAD', 'POST'].includes(o?.method ?? 'GET'))).toBe(true);
    });

    it(`${entry.tool} resolves a namespaced function-group include`, async () => {
      const client = newClient();
      vi.spyOn(client, 'lookupObjects').mockResolvedValue([
        {
          name: '/ARC/LGROUPF01',
          found: true,
          matches: [match('FUGR/I', '/sap/bc/adt/functions/groups/%2Farc%2Fgroup/includes/%2Farc%2Flgroupf01')],
        },
      ] as never);
      await handleToolCall(client, DEFAULT_CONFIG, entry.tool, { ...entry.args, name: '/ARC/LGROUPF01' }, reader);
      expect(String(posts()[0][1]?.body)).toContain(
        'adtcore:uri="/sap/bc/adt/functions/groups/%2Farc%2Fgroup/includes/%2Farc%2Flgroupf01"',
      );
    });

    it(`${entry.tool} keeps a standalone include on the program-include path without a lookup`, async () => {
      const client = newClient();
      const lookup = vi.spyOn(client, 'lookupObjects');
      await handleToolCall(client, DEFAULT_CONFIG, entry.tool, { ...entry.args, name: 'ZARC1_INCL' }, reader);
      expect(lookup).not.toHaveBeenCalled();
      expect(String(posts()[0][1]?.body).toLowerCase()).toContain(
        'adtcore:uri="/sap/bc/adt/programs/includes/zarc1_incl"',
      );
    });

    it(`${entry.tool} keeps an L-named program include on the program-include path`, async () => {
      const client = newClient();
      vi.spyOn(client, 'lookupObjects').mockResolvedValue([
        { name: 'LZARC1F01', found: true, matches: [match('PROG/I', '/sap/bc/adt/programs/includes/LZARC1F01')] },
      ] as never);
      await handleToolCall(client, DEFAULT_CONFIG, entry.tool, { ...entry.args, name: 'LZARC1F01' }, reader);
      expect(String(posts()[0][1]?.body).toLowerCase()).toContain(
        'adtcore:uri="/sap/bc/adt/programs/includes/lzarc1f01"',
      );
    });

    it(`${entry.tool} reports an unverified owner as not checked, without checking`, async () => {
      const client = newClient();
      vi.spyOn(client, 'lookupObjects').mockResolvedValue([
        {
          name: 'LZARC1F01',
          found: true,
          matches: [
            match('FUGR/I', structural),
            match('FUGR/I', '/sap/bc/adt/functions/groups/zother/includes/lzarc1f01'),
          ],
        },
      ] as never);
      const result = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        entry.tool,
        { ...entry.args, name: 'LZARC1F01' },
        reader,
      );
      expect(result.isError).not.toBe(true);
      const parsed = JSON.parse(String(result.content[0]?.text));
      expect(parsed).toMatchObject({ checked: false, hasErrors: true });
      expect(parsed.messages[0].text).toContain('could not be verified');
      expect(parsed.messages[0].text).not.toContain('Provide "group"');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each([403, 500])(`${entry.tool} propagates lookup failure %s`, async (status) => {
      const client = newClient();
      vi.spyOn(client, 'lookupObjects').mockRejectedValue(new AdtApiError('lookup failed', status, '/search'));
      const result = await handleToolCall(
        client,
        DEFAULT_CONFIG,
        entry.tool,
        { ...entry.args, name: 'LZARC1F01' },
        reader,
      );
      expect(result.isError).toBe(true);
      expect(String(result.content[0]?.text)).toContain(`status ${status}`);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  }
});
